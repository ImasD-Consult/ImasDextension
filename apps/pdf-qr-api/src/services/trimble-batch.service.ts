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
	const set = new Set<string>();
	if (input?.trim()) set.add(input.trim().replace(/\/$/, ""));
	for (const h of DEFAULT_HOSTS) set.add(h);
	return [...set];
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
			`/tc/api/2.0/folders/${encodeURIComponent(parentFolderId)}/items?projectId=${encodeURIComponent(projectId)}`,
			`/tc/api/2.1/folders/${encodeURIComponent(parentFolderId)}/items?projectId=${encodeURIComponent(projectId)}`,
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

async function downloadPdfFromTrimble(
	hosts: string[],
	accessToken: string,
	projectId: string,
	fileId: string,
): Promise<Uint8Array> {
	const paths = [
		`/tc/api/2.0/files/${encodeURIComponent(fileId)}/download?projectId=${encodeURIComponent(projectId)}`,
		`/tc/api/2.1/files/${encodeURIComponent(fileId)}/download?projectId=${encodeURIComponent(projectId)}`,
		`/tc/api/2.0/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/download`,
		`/tc/api/2.1/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/download`,
		`/tc/api/2.0/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/download?projectId=${encodeURIComponent(projectId)}`,
		`/tc/api/2.1/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/download?projectId=${encodeURIComponent(projectId)}`,
		`/tc/api/2.0/files/${encodeURIComponent(fileId)}/download`,
		`/tc/api/2.1/files/${encodeURIComponent(fileId)}/download`,
	];
	const urls = hosts.flatMap((h) => paths.map((p) => `${h}${p}`));
	let lastError: unknown;
	const attempts: string[] = [];
	for (const url of urls) {
		try {
			const res = await fetch(url, {
				headers: {
					Authorization: `Bearer ${accessToken}`,
					Accept: "application/pdf",
				},
			});
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
		const running: TrimbleBatchStatusResponse = {
			...queued,
			status: "running",
			startedAt: nowMs(),
		};
		await saveStatus(app, env, running);
		const results: FileResult[] = [];
		try {
			hosts = await resolvePreferredHosts(
				hosts,
				input.trimble.accessToken,
				input.trimble.projectId,
				input.items[0]?.pdfFileId ?? "",
			);
			const qrFolderId = await ensureSubfolder(
				hosts,
				input.trimble.accessToken,
				input.trimble.projectId,
				input.trimble.pdfParentFolderId,
				input.trimble.outputSubfolderName,
			);
			let done = 0;
			for (const item of input.items) {
				try {
					const sourcePdf = await downloadPdfFromTrimble(
						hosts,
						input.trimble.accessToken,
						input.trimble.projectId,
						item.pdfFileId,
					);
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
					const outputFileId = await uploadPdfToTrimble(
						hosts,
						input.trimble.accessToken,
						input.trimble.projectId,
						qrFolderId,
						item.pdfFileName,
						stamped,
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
				}
				done += 1;
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
		} catch (error) {
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
