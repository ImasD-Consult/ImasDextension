import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Env } from "../lib/env";
import { stampPdfWithQr } from "../lib/mupdf-stamp";
import { trimbleBatchStatusKey } from "../lib/redis-keys";
import type {
	TrimbleBatchRequest,
	TrimbleBatchStatusResponse,
} from "../lib/schemas";

type FileResult = {
	pdfFileId: string;
	ok: boolean;
	outputFileId: string | null;
	message?: string | null;
};

const DEFAULT_HOSTS = [
	"https://app.connect.trimble.com",
	"https://app21.connect.trimble.com",
	"https://app31.connect.trimble.com",
];

function buildHosts(input?: string): string[] {
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
	for (const host of DEFAULT_HOSTS) ordered.add(host);
	return [...ordered];
}

async function resolvePreferredHosts(
	hosts: string[],
	accessToken: string,
	projectId: string,
	probeObjectId: string,
): Promise<string[]> {
	const path = `/tc/api/2.0/tags?projectId=${encodeURIComponent(projectId)}&objectId=${encodeURIComponent(probeObjectId)}&objectType=FILE`;
	for (const host of hosts) {
		try {
			const res = await fetch(`${host}${path}`, {
				headers: {
					Authorization: `Bearer ${accessToken}`,
					Accept: "application/json",
				},
			});
			if (!res.ok) continue;
			const ctype = (res.headers.get("content-type") || "").toLowerCase();
			if (!ctype.includes("application/json")) continue;
			// Host is valid for this project/object.
			return [host, ...hosts.filter((h) => h !== host)];
		} catch {
			// try next host
		}
	}
	return hosts;
}

async function resolveProjectRegionHost(
	hosts: string[],
	accessToken: string,
	projectId: string,
): Promise<string[]> {
	for (const host of hosts) {
		for (const path of [
			`/tc/api/2.0/projects/${encodeURIComponent(projectId)}`,
			`/tc/api/2.1/projects/${encodeURIComponent(projectId)}`,
			`/tc/api/2.0/projects?ids=${encodeURIComponent(projectId)}`,
			`/tc/api/2.1/projects?ids=${encodeURIComponent(projectId)}`,
		]) {
			try {
				const res = await fetch(`${host}${path}`, {
					headers: {
						Authorization: `Bearer ${accessToken}`,
						Accept: "application/json",
					},
				});
				if (!res.ok) continue;
				const ctype = (res.headers.get("content-type") || "").toLowerCase();
				if (!ctype.includes("application/json")) continue;
				// Prefer detected host first, but keep fallbacks for endpoint variance.
				return [host, ...hosts.filter((h) => h !== host)];
			} catch {
				// try next path/host
			}
		}
	}
	return hosts;
}

function nowMs(): number {
	return Date.now();
}

async function saveStatus(
	app: FastifyInstance,
	env: Env,
	status: TrimbleBatchStatusResponse,
): Promise<void> {
	await app.redis.setex(
		trimbleBatchStatusKey(status.jobId),
		env.JOB_RESULT_TTL_SEC,
		JSON.stringify(status),
	);
}

export async function loadTrimbleBatchStatus(
	app: FastifyInstance,
	jobId: string,
): Promise<TrimbleBatchStatusResponse | null> {
	const raw = await app.redis.get(trimbleBatchStatusKey(jobId));
	if (!raw) return null;
	try {
		return JSON.parse(raw) as TrimbleBatchStatusResponse;
	} catch {
		return null;
	}
}

async function trimbleFetch(
	hosts: string[],
	paths: string[],
	accessToken: string,
	init?: RequestInit,
	opts?: { expectJson?: boolean },
): Promise<Response> {
	const urls = hosts.flatMap((h) => paths.map((p) => `${h}${p}`));
	let lastError: unknown;
	for (const url of urls) {
		try {
			const res = await fetch(url, {
				...init,
				headers: {
					Authorization: `Bearer ${accessToken}`,
					Accept: "application/json",
					...(init?.headers ?? {}),
				},
			});
			if (res.ok) {
				if (opts?.expectJson) {
					const ctype = (res.headers.get("content-type") || "").toLowerCase();
					if (!ctype.includes("application/json")) {
						lastError = new Error(
							`Unexpected content-type "${ctype}" at ${url} (expected JSON)`,
						);
						continue;
					}
				}
				return res;
			}
			lastError = new Error(`HTTP ${res.status} at ${url}`);
		} catch (e) {
			lastError = e;
		}
	}
	throw lastError instanceof Error
		? lastError
		: new Error("Trimble request failed.");
}

async function ensureSubfolder(
	hosts: string[],
	accessToken: string,
	projectId: string,
	parentFolderId: string,
	subfolderName: string,
): Promise<string> {
	const listRes = await trimbleFetch(
		hosts,
		[
			`/tc/api/2.1/folders/${encodeURIComponent(parentFolderId)}/items?projectId=${encodeURIComponent(projectId)}`,
			`/tc/api/2.1/folders/${encodeURIComponent(parentFolderId)}/items`,
			`/tc/api/folders/${encodeURIComponent(parentFolderId)}/items`,
			`/tc/api/2.0/folders/${encodeURIComponent(parentFolderId)}/items?projectId=${encodeURIComponent(projectId)}`,
		],
		accessToken,
		undefined,
		{ expectJson: true },
	);
	const listJson = (await listRes.json()) as Record<string, unknown>;
	const items =
		(listJson.items as Array<Record<string, unknown>> | undefined) ??
		(Array.isArray(listJson) ? (listJson as Array<Record<string, unknown>>) : []);
	const existing = items.find(
		(x) =>
			String(x.type ?? "").toUpperCase() === "FOLDER" &&
			String(x.name ?? "").trim().toLowerCase() ===
				subfolderName.trim().toLowerCase(),
	);
	if (existing) {
		const id = String(existing.id ?? existing.versionId ?? "");
		if (id) return id;
	}

	const body = JSON.stringify({
		name: subfolderName,
		parentId: parentFolderId,
		projectId,
	});
	const createRes = await trimbleFetch(
		hosts,
		[
			`/tc/api/2.1/folders`,
			`/tc/api/folders`,
			`/tc/api/2.0/projects/${encodeURIComponent(projectId)}/folders`,
			`/tc/api/2.0/folders?projectId=${encodeURIComponent(projectId)}`,
		],
		accessToken,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body,
		},
		{ expectJson: true },
	);
	const raw = (await createRes.json()) as Record<string, unknown>;
	const folderId = String(raw.id ?? raw.versionId ?? "");
	if (!folderId) throw new Error("Could not resolve created QR folder id.");
	return folderId;
}

type ResolvedTrimbleFile = {
	fileId: string;
	downloadUrls: string[];
	versionId?: string;
};

function collectDownloadUrlsFromObject(
	root: Record<string, unknown>,
): string[] {
	const out = new Set<string>();
	const walk = (node: unknown, depth: number): void => {
		if (depth > 8 || node == null) return;
		if (typeof node === "string") {
			const s = node.trim();
			if (/^https?:\/\//i.test(s) && /download|content|signed|s3/i.test(s)) {
				out.add(s);
			}
			return;
		}
		if (Array.isArray(node)) {
			for (const item of node) walk(item, depth + 1);
			return;
		}
		if (typeof node === "object") {
			for (const value of Object.values(node as Record<string, unknown>)) {
				walk(value, depth + 1);
			}
		}
	};
	walk(root, 0);
	return [...out];
}

async function resolveTrimbleFile(
	hosts: string[],
	accessToken: string,
	projectId: string,
	idOrVersionId: string,
): Promise<ResolvedTrimbleFile> {
	const res = await trimbleFetch(
		hosts,
		[
			`/tc/api/2.0/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(idOrVersionId)}`,
			`/tc/api/2.1/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(idOrVersionId)}`,
			`/tc/api/2.0/files/${encodeURIComponent(idOrVersionId)}?projectId=${encodeURIComponent(projectId)}`,
			`/tc/api/2.1/files/${encodeURIComponent(idOrVersionId)}?projectId=${encodeURIComponent(projectId)}`,
		],
		accessToken,
		undefined,
		{ expectJson: true },
	);
	const raw = (await res.json()) as Record<string, unknown>;
	const fileId = String(
		raw.fileId ??
			raw.id ??
			(raw.file as Record<string, unknown> | undefined)?.id ??
			(raw.data as Record<string, unknown> | undefined)?.id ??
			idOrVersionId,
	);
	return {
		fileId,
		downloadUrls: collectDownloadUrlsFromObject(raw),
		versionId: String(raw.versionId ?? (raw.file as Record<string, unknown> | undefined)?.versionId ?? ""),
	};
}

async function downloadPdfFromTrimble(
	hosts: string[],
	accessToken: string,
	projectId: string,
	fileId: string,
): Promise<Uint8Array> {
	const resolved = await resolveTrimbleFile(
		hosts,
		accessToken,
		projectId,
		fileId,
	);
	const canonicalId = resolved.fileId || fileId;
	const signedUrlRes = await trimbleFetch(
		hosts,
		[
			`/tc/api/2.1/files/fs/${encodeURIComponent(canonicalId)}/downloadurl?projectId=${encodeURIComponent(projectId)}${resolved.versionId ? `&versionId=${encodeURIComponent(resolved.versionId)}` : ""}`,
			`/tc/api/2.0/files/fs/${encodeURIComponent(canonicalId)}/downloadurl?projectId=${encodeURIComponent(projectId)}${resolved.versionId ? `&versionId=${encodeURIComponent(resolved.versionId)}` : ""}`,
		],
		accessToken,
		undefined,
		{ expectJson: true },
	);
	const signedJson = (await signedUrlRes.json()) as Record<string, unknown>;
	const signedUrl = String(
		signedJson.downloadUrl ??
			signedJson.url ??
			(signedJson.data as Record<string, unknown> | undefined)?.downloadUrl ??
			"",
	).trim();
	const paths = [
		`/tc/api/2.0/files/${encodeURIComponent(canonicalId)}/download?projectId=${encodeURIComponent(projectId)}`,
		`/tc/api/2.1/files/${encodeURIComponent(canonicalId)}/download?projectId=${encodeURIComponent(projectId)}`,
		`/tc/api/2.0/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(canonicalId)}/download`,
		`/tc/api/2.1/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(canonicalId)}/download`,
		`/tc/api/2.0/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(canonicalId)}/download?projectId=${encodeURIComponent(projectId)}`,
		`/tc/api/2.1/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(canonicalId)}/download?projectId=${encodeURIComponent(projectId)}`,
		`/tc/api/2.0/files/${encodeURIComponent(canonicalId)}/download`,
		`/tc/api/2.1/files/${encodeURIComponent(canonicalId)}/download`,
	];
	const urls = [
		...(signedUrl ? [signedUrl] : []),
		...resolved.downloadUrls,
		...hosts.flatMap((h) => paths.map((p) => `${h}${p}`)),
	];
	let lastError: unknown;
	const attempts: string[] = [];
	for (const url of urls) {
		try {
			const isDirectDataUrl = /\/tc\/api\/\d+\.\d+\/data\//i.test(url);
			const headersNoAuth: HeadersInit = { Accept: "application/pdf" };
			const headersWithAuth: HeadersInit = {
				Accept: "application/pdf",
				Authorization: `Bearer ${accessToken}`,
			};
			let res: Response;
			if (isDirectDataUrl) {
				// Signed /data URLs may reject bearer headers; try clean request first.
				res = await fetch(url, { headers: headersNoAuth });
				if (!res.ok) {
					attempts.push(`HTTP ${res.status} @ ${url} (no-auth)`);
					res = await fetch(url, { headers: headersWithAuth });
				}
			} else {
				res = await fetch(url, { headers: headersWithAuth });
			}
			if (!res.ok) {
				attempts.push(`HTTP ${res.status} @ ${url}`);
				lastError = new Error(`HTTP ${res.status} at ${url}`);
				continue;
			}
			const bytes = new Uint8Array(await res.arrayBuffer());
			const ctype = (res.headers.get("content-type") || "").toLowerCase();
			const isPdfByType = ctype.includes("application/pdf");
			const isPdfByMagic =
				bytes.length >= 4 &&
				bytes[0] === 0x25 && // %
				bytes[1] === 0x50 && // P
				bytes[2] === 0x44 && // D
				bytes[3] === 0x46; // F
			if (isPdfByType || isPdfByMagic) {
				return bytes;
			}
			attempts.push(
				`Non-PDF content-type "${ctype || "unknown"}" @ ${url}`,
			);
			lastError = new Error(
				`Non-PDF response at ${url} (content-type: ${ctype || "unknown"})`,
			);
		} catch (e) {
			attempts.push(
				`${e instanceof Error ? e.message : "request failed"} @ ${url}`,
			);
			lastError = e;
		}
	}
	const details = attempts.slice(0, 8).join(" | ");
	if (lastError instanceof Error) {
		throw new Error(`${lastError.message}${details ? ` (attempts: ${details})` : ""}`);
	}
	throw new Error(
		`Could not download a valid PDF from Trimble.${details ? ` Attempts: ${details}` : ""}`,
	);
}

async function uploadPdfToTrimble(
	hosts: string[],
	accessToken: string,
	projectId: string,
	parentFolderId: string,
	fileName: string,
	pdfBytes: Uint8Array,
): Promise<string> {
	let lastError: unknown;
	for (const host of hosts) {
		try {
			const initRes = await fetch(
				`${host}/tc/api/2.1/files/fs/upload?parentId=${encodeURIComponent(parentFolderId)}&parentType=FOLDER`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${accessToken}`,
						Accept: "application/json",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ name: fileName }),
				},
			);
			if (initRes.ok) {
				const ctype = (initRes.headers.get("content-type") || "").toLowerCase();
				if (ctype.includes("application/json")) {
					const initJson = (await initRes.json()) as Record<string, unknown>;
					const uploadUrl = String(
						initJson.uploadUrl ??
							initJson.uploadURL ??
							(initJson.contents as Array<Record<string, unknown>> | undefined)?.[0]
								?.uploadUrl ??
							(initJson.contents as Array<Record<string, unknown>> | undefined)?.[0]
								?.uploadURL ??
							"",
					);
					const uploadId = String(initJson.uploadId ?? "");
					if (uploadUrl) {
						const arrBuf = pdfBytes.buffer.slice(
							pdfBytes.byteOffset,
							pdfBytes.byteOffset + pdfBytes.byteLength,
						) as ArrayBuffer;
						const putRes = await fetch(uploadUrl, {
							method: "PUT",
							headers: { "Content-Type": "application/pdf" },
							body: new Blob([arrBuf], { type: "application/pdf" }),
						});
						if (putRes.ok) {
							if (uploadId) {
								const detailsRes = await fetch(
									`${host}/tc/api/2.1/files/fs/upload?uploadId=${encodeURIComponent(uploadId)}&wait=true`,
									{
										headers: {
											Authorization: `Bearer ${accessToken}`,
											Accept: "application/json",
										},
									},
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
								}
							}
						} else {
							lastError = new Error(`HTTP ${putRes.status} at ${uploadUrl}`);
						}
					}
				}
			}
		} catch (e) {
			lastError = e;
		}

		for (const path of [
			`/tc/api/2.0/projects/${encodeURIComponent(projectId)}/files?parentId=${encodeURIComponent(parentFolderId)}`,
			`/tc/api/2.0/files?projectId=${encodeURIComponent(projectId)}&parentId=${encodeURIComponent(parentFolderId)}`,
		]) {
			try {
				const fd = new FormData();
				const arrBuf = pdfBytes.buffer.slice(
					pdfBytes.byteOffset,
					pdfBytes.byteOffset + pdfBytes.byteLength,
				) as ArrayBuffer;
				fd.append(
					"file",
					new Blob([arrBuf], { type: "application/pdf" }),
					fileName,
				);
				fd.append("name", fileName);
				fd.append("parentId", parentFolderId);
				fd.append("projectId", projectId);
				const res = await fetch(`${host}${path}`, {
					method: "POST",
					headers: { Authorization: `Bearer ${accessToken}` },
					body: fd,
				});
				if (!res.ok) {
					lastError = new Error(`HTTP ${res.status} at ${host}${path}`);
					continue;
				}
				const ctype = (res.headers.get("content-type") || "").toLowerCase();
				if (!ctype.includes("application/json")) {
					lastError = new Error(
						`Unexpected content-type "${ctype}" at ${host}${path} (expected JSON)`,
					);
					continue;
				}
				const raw = (await res.json()) as Record<string, unknown>;
				const fileId = String(raw.id ?? raw.fileId ?? "");
				if (fileId) return fileId;
				lastError = new Error("Upload returned OK without file id.");
			} catch (e) {
				lastError = e;
			}
		}
	}
	throw lastError instanceof Error ? lastError : new Error("Upload failed.");
}

export async function startTrimbleBatchJob(
	app: FastifyInstance,
	env: Env,
	input: TrimbleBatchRequest,
): Promise<{ jobId: string; status: "queued" }> {
	const jobId = randomUUID();
	const queued: TrimbleBatchStatusResponse = {
		jobId,
		status: "queued",
		progress: { done: 0, total: input.items.length },
		startedAt: null,
		finishedAt: null,
		error: null,
		results: [],
	};
	await saveStatus(app, env, queued);

	void (async () => {
		let hosts = buildHosts(input.trimble.host);
		app.log.info(
			{
				jobId,
				projectId: input.trimble.projectId,
				items: input.items.length,
				initialHosts: hosts,
			},
			"trimble_batch_job_started",
		);
		const running: TrimbleBatchStatusResponse = {
			...queued,
			status: "running",
			startedAt: nowMs(),
		};
		await saveStatus(app, env, running);
		const results: FileResult[] = [];
		try {
			hosts = await resolveProjectRegionHost(
				hosts,
				input.trimble.accessToken,
				input.trimble.projectId,
			);
			app.log.info({ jobId, hosts }, "trimble_batch_hosts_after_region_probe");
			hosts = await resolvePreferredHosts(
				hosts,
				input.trimble.accessToken,
				input.trimble.projectId,
				input.items[0]?.pdfFileId ?? "",
			);
			app.log.info({ jobId, hosts }, "trimble_batch_hosts_after_preference_probe");
			const qrFolderId = await ensureSubfolder(
				hosts,
				input.trimble.accessToken,
				input.trimble.projectId,
				input.trimble.pdfParentFolderId,
				input.trimble.outputSubfolderName,
			);
			app.log.info(
				{ jobId, qrFolderId, outputSubfolderName: input.trimble.outputSubfolderName },
				"trimble_batch_qr_folder_ready",
			);
			let done = 0;
			for (const item of input.items) {
				try {
					app.log.info(
						{ jobId, pdfFileId: item.pdfFileId, pdfFileName: item.pdfFileName },
						"trimble_batch_item_download_start",
					);
					const sourcePdf = await downloadPdfFromTrimble(
						hosts,
						input.trimble.accessToken,
						input.trimble.projectId,
						item.pdfFileId,
					);
					app.log.info(
						{ jobId, pdfFileId: item.pdfFileId, bytes: sourcePdf.byteLength },
						"trimble_batch_item_download_ok",
					);
					app.log.info({ jobId, pdfFileId: item.pdfFileId }, "trimble_batch_item_stamp_start");
					const { pdf: stamped } = await stampPdfWithQr(
						sourcePdf,
						{
							qrText: item.qrText,
							position: input.stamp.position,
							marginPt: input.stamp.marginPt,
							layoutMode: input.stamp.layoutMode,
							offsetXPt: input.stamp.offsetXPt,
							offsetYPt: input.stamp.offsetYPt,
							qrSizePt: input.stamp.qrSizePt,
						},
						{ maxPages: env.MAX_PDF_PAGES },
					);
					app.log.info(
						{ jobId, pdfFileId: item.pdfFileId, bytes: stamped.byteLength },
						"trimble_batch_item_stamp_ok",
					);
					app.log.info({ jobId, pdfFileId: item.pdfFileId }, "trimble_batch_item_upload_start");
					const outputFileId = await uploadPdfToTrimble(
						hosts,
						input.trimble.accessToken,
						input.trimble.projectId,
						qrFolderId,
						item.pdfFileName,
						stamped,
					);
					app.log.info(
						{ jobId, pdfFileId: item.pdfFileId, outputFileId },
						"trimble_batch_item_upload_ok",
					);
					results.push({
						pdfFileId: item.pdfFileId,
						ok: true,
						outputFileId,
						message: null,
					});
				} catch (error) {
					results.push({
						pdfFileId: item.pdfFileId,
						ok: false,
						outputFileId: null,
						message: error instanceof Error ? error.message : "Unknown error",
					});
					app.log.error(
						{
							jobId,
							pdfFileId: item.pdfFileId,
							error: error instanceof Error ? error.message : "Unknown error",
						},
						"trimble_batch_item_failed",
					);
				}
				done += 1;
				app.log.info({ jobId, done, total: input.items.length }, "trimble_batch_progress");
				await saveStatus(app, env, {
					...running,
					progress: { done, total: input.items.length },
					results,
				});
			}
			await saveStatus(app, env, {
				...running,
				status: results.some((r) => !r.ok) ? "failed" : "completed",
				progress: { done: results.length, total: input.items.length },
				results,
				error: results.some((r) => !r.ok)
					? "Some files failed. See results."
					: null,
				finishedAt: nowMs(),
			});
			app.log.info(
				{
					jobId,
					status: results.some((r) => !r.ok) ? "failed" : "completed",
					done: results.length,
					total: input.items.length,
				},
				"trimble_batch_job_finished",
			);
		} catch (error) {
			app.log.error(
				{
					jobId,
					error: error instanceof Error ? error.message : "Batch failed",
				},
				"trimble_batch_job_failed_before_items",
			);
			await saveStatus(app, env, {
				...running,
				status: "failed",
				error: error instanceof Error ? error.message : "Batch failed",
				finishedAt: nowMs(),
				results,
			});
		}
	})();

	return { jobId, status: "queued" };
}
