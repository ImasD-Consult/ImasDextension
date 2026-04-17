/**
 * Trimble Connect file upload: Package File Upload API first, legacy multipart fallback.
 * Shared by batch QR and version-history upload so behavior stays aligned.
 */

import { fetchWithTimeout } from "../lib/fetch-with-timeout";

/** Keep under reverse-proxy / Cloudflare origin ceilings; `wait=true` can otherwise hang minutes. */
const FS_INIT_MS = 25_000;
const FS_PUT_MS = 90_000;
const FS_STATUS_WAIT_MS = 50_000;
const LEGACY_UPLOAD_MS = 90_000;

const DEFAULT_TRIMBLE_HOSTS = [
	"https://app.connect.trimble.com",
	"https://app21.connect.trimble.com",
	"https://app31.connect.trimble.com",
];

export function buildTrimbleHosts(input?: string): string[] {
	const ordered = new Set<string>();
	if (input?.trim()) {
		try {
			const u = new URL(input.trim());
			// Guard against web.connect host (serves HTML, not Core API JSON).
			if (/^app\d*\.connect\.trimble\.com$/i.test(u.hostname)) {
				ordered.add(u.origin.replace(/\/$/, ""));
			}
		} catch {
			// ignore invalid provided host and fall back to defaults
		}
	}
	for (const host of DEFAULT_TRIMBLE_HOSTS) ordered.add(host);
	return [...ordered];
}

function collectHttpUrlsFromObject(root: Record<string, unknown>): string[] {
	const out = new Set<string>();
	const walk = (node: unknown, depth: number): void => {
		if (depth > 10 || node == null) return;
		if (typeof node === "string") {
			const s = node.trim();
			if (/^https?:\/\//i.test(s)) out.add(s);
			return;
		}
		if (Array.isArray(node)) {
			for (const item of node) walk(item, depth + 1);
			return;
		}
		if (typeof node === "object") {
			for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
				if (
					typeof v === "string" &&
					/^https?:\/\//i.test(v) &&
					/(upload|url|signed|presign|storage|s3)/i.test(k)
				) {
					out.add(v.trim());
				}
				walk(v, depth + 1);
			}
		}
	};
	walk(root, 0);
	return [...out];
}

/**
 * @param existingFileId When set, upload a new version of that file (parentType=FILE). Otherwise create/upload under folder (FOLDER).
 */
export async function uploadFileToTrimbleFolder(
	hosts: string[],
	accessToken: string,
	projectId: string,
	parentFolderId: string,
	fileName: string,
	fileBytes: Uint8Array,
	contentType: string,
	existingFileId?: string,
): Promise<string> {
	let lastError: unknown;
	const attempts: string[] = [];
	const folderQuery = `parentId=${encodeURIComponent(parentFolderId)}&parentType=FOLDER&projectId=${encodeURIComponent(projectId)}`;
	const fileVersionQuery = existingFileId
		? `parentId=${encodeURIComponent(existingFileId)}&parentType=FILE&projectId=${encodeURIComponent(projectId)}`
		: null;

	for (const host of hosts) {
		try {
			for (const fsPath of [
				"/tc/api/2.1/files/fs/upload",
				"/tc/api/2.0/files/fs/upload",
				"/tc/api/files/fs/upload",
			]) {
				const query =
					fileVersionQuery !== null
						? fileVersionQuery
						: folderQuery;
				attempts.push(`fs_upload_init @ ${host}${fsPath}`);
				const initRes = await fetchWithTimeout(
					`${host}${fsPath}?${query}`,
					{
						method: "POST",
						headers: {
							Authorization: `Bearer ${accessToken}`,
							Accept: "application/json",
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ name: fileName }),
					},
					FS_INIT_MS,
				);
				if (initRes.ok) {
					const ctype = (initRes.headers.get("content-type") || "").toLowerCase();
					if (ctype.includes("application/json")) {
						const initJson = (await initRes.json()) as Record<string, unknown>;
						const uploadUrlsFromContents = (
							(initJson.contents as Array<Record<string, unknown>> | undefined)?.[0]
								?.uploadUrls as string[] | undefined
						)?.filter(Boolean);
						const uploadUrlsTop = (
							initJson.uploadUrls as string[] | undefined
						)?.filter(Boolean);
						const discoveredHttpUrls = collectHttpUrlsFromObject(initJson);
						const uploadUrl = String(
							initJson.uploadUrl ??
								initJson.uploadURL ??
								uploadUrlsTop?.[0] ??
								uploadUrlsFromContents?.[0] ??
								(initJson.contents as Array<Record<string, unknown>> | undefined)?.[0]
									?.uploadUrl ??
								(initJson.contents as Array<Record<string, unknown>> | undefined)?.[0]
									?.uploadURL ??
								(initJson.data as Record<string, unknown> | undefined)?.uploadUrl ??
								(
									(initJson.data as Record<string, unknown> | undefined)
										?.uploadUrls as string[] | undefined
								)?.[0] ??
								discoveredHttpUrls[0] ??
								"",
						);
						const uploadId = String(initJson.uploadId ?? "");
						if (uploadUrl) {
							attempts.push(`fs_upload_put @ ${uploadUrl}`);
							const arrBuf = fileBytes.buffer.slice(
								fileBytes.byteOffset,
								fileBytes.byteOffset + fileBytes.byteLength,
							) as ArrayBuffer;
							const putRes = await fetchWithTimeout(
								uploadUrl,
								{
									method: "PUT",
									body: new Blob([arrBuf], { type: contentType }),
								},
								FS_PUT_MS,
							);
							if (putRes.ok) {
								if (uploadId) {
									attempts.push(`fs_upload_status @ ${host}${fsPath} uploadId=${uploadId}`);
									const detailsRes = await fetchWithTimeout(
										`${host}${fsPath}?uploadId=${encodeURIComponent(uploadId)}&wait=true`,
										{
											headers: {
												Authorization: `Bearer ${accessToken}`,
												Accept: "application/json",
											},
										},
										FS_STATUS_WAIT_MS,
									);
									if (detailsRes.ok) {
										const details = (await detailsRes.json()) as Record<string, unknown>;
										const uploadedId = String(
											details.fileId ??
												details.id ??
												(details.file as Record<string, unknown> | undefined)?.id ??
												"",
										);
										if (uploadedId) return uploadedId;
										attempts.push(`fs_upload_status_no_file_id @ ${host}${fsPath}`);
									}
									if (!detailsRes.ok) {
										attempts.push(
											`fs_upload_status_http_${detailsRes.status} @ ${host}${fsPath}`,
										);
									}
								} else {
									const directId = String(
										initJson.fileId ??
											initJson.id ??
											(
												initJson.file as Record<string, unknown> | undefined
											)?.id ??
											(
												(initJson.contents as
													| Array<Record<string, unknown>>
													| undefined)?.[0] as Record<string, unknown> | undefined
											)?.id ??
											"",
									);
									if (directId) return directId;
									attempts.push(
										`fs_upload_put_ok_no_upload_id_no_direct_file_id @ ${host}${fsPath}`,
									);
								}
							} else {
								lastError = new Error(`HTTP ${putRes.status} at ${uploadUrl}`);
								attempts.push(`fs_upload_put_http_${putRes.status} @ ${uploadUrl}`);
							}
						}
						if (!uploadUrl) {
							attempts.push(
								`fs_upload_init_no_upload_url @ ${host}${fsPath} keys=${Object.keys(initJson).join(",")}`,
							);
						}
					}
					if (!ctype.includes("application/json")) {
						attempts.push(
							`fs_upload_init_non_json_${ctype || "unknown"} @ ${host}${fsPath}`,
						);
					}
				} else {
					lastError = new Error(
						`HTTP ${initRes.status} at ${host}${fsPath}`,
					);
					attempts.push(`fs_upload_init_http_${initRes.status} @ ${host}${fsPath}`);
				}
			}
		} catch (e) {
			lastError = e;
			attempts.push(
				`fs_upload_exception @ ${host}: ${e instanceof Error ? e.message : "unknown"}`,
			);
		}

		const legacyPaths = existingFileId
			? [
					`/tc/api/2.0/projects/${encodeURIComponent(projectId)}/files?parentId=${encodeURIComponent(existingFileId)}&parentType=FILE`,
					`/tc/api/2.1/projects/${encodeURIComponent(projectId)}/files?parentId=${encodeURIComponent(existingFileId)}&parentType=FILE`,
					`/tc/api/2.0/files?projectId=${encodeURIComponent(projectId)}&parentId=${encodeURIComponent(existingFileId)}&parentType=FILE`,
					`/tc/api/2.1/files?projectId=${encodeURIComponent(projectId)}&parentId=${encodeURIComponent(existingFileId)}&parentType=FILE`,
				]
			: [
					`/tc/api/2.0/projects/${encodeURIComponent(projectId)}/files?parentId=${encodeURIComponent(parentFolderId)}`,
					`/tc/api/2.1/projects/${encodeURIComponent(projectId)}/files?parentId=${encodeURIComponent(parentFolderId)}`,
					`/tc/api/2.0/files?projectId=${encodeURIComponent(projectId)}&parentId=${encodeURIComponent(parentFolderId)}`,
					`/tc/api/2.1/files?projectId=${encodeURIComponent(projectId)}&parentId=${encodeURIComponent(parentFolderId)}`,
				];
		const legacyParentId = existingFileId ?? parentFolderId;
		for (const path of legacyPaths) {
			try {
				attempts.push(`legacy_upload @ ${host}${path}`);
				const fd = new FormData();
				const arrBuf = fileBytes.buffer.slice(
					fileBytes.byteOffset,
					fileBytes.byteOffset + fileBytes.byteLength,
				) as ArrayBuffer;
				fd.append(
					"file",
					new Blob([arrBuf], { type: contentType }),
					fileName,
				);
				fd.append("name", fileName);
				fd.append("parentId", legacyParentId);
				if (existingFileId) fd.append("parentType", "FILE");
				fd.append("projectId", projectId);
				const res = await fetchWithTimeout(
					`${host}${path}`,
					{
						method: "POST",
						headers: { Authorization: `Bearer ${accessToken}` },
						body: fd,
					},
					LEGACY_UPLOAD_MS,
				);
				if (!res.ok) {
					lastError = new Error(`HTTP ${res.status} at ${host}${path}`);
					attempts.push(`legacy_upload_http_${res.status} @ ${host}${path}`);
					continue;
				}
				const ctype = (res.headers.get("content-type") || "").toLowerCase();
				if (!ctype.includes("application/json")) {
					lastError = new Error(
						`Unexpected content-type "${ctype}" at ${host}${path} (expected JSON)`,
					);
					attempts.push(
						`legacy_upload_non_json_${ctype || "unknown"} @ ${host}${path}`,
					);
					continue;
				}
				const raw = (await res.json()) as Record<string, unknown>;
				const fileId = String(raw.id ?? raw.fileId ?? "");
				if (fileId) return fileId;
				lastError = new Error("Upload returned OK without file id.");
				attempts.push(`legacy_upload_no_file_id @ ${host}${path}`);
			} catch (e) {
				lastError = e;
				attempts.push(
					`legacy_upload_exception @ ${host}${path}: ${e instanceof Error ? e.message : "unknown"}`,
				);
			}
		}
	}
	const details = attempts.slice(0, 12).join(" | ");
	if (lastError instanceof Error) {
		throw new Error(`${lastError.message}${details ? ` (upload attempts: ${details})` : ""}`);
	}
	throw new Error(`Upload failed.${details ? ` Attempts: ${details}` : ""}`);
}
