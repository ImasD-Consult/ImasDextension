import type { MultipartFile } from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

type VersionRow = {
	fileId: string;
	versionId?: string;
	name: string;
	description?: string;
	updatedAt?: string;
	originalName?: string;
};

const fieldSchema = z.object({
	file: z.custom<MultipartFile>(),
	access_token: z.string().min(1),
	project_id: z.string().min(1),
	parent_folder_id: z.string().min(1),
	target_name: z.string().min(1),
	original_name: z.string().min(1),
	connect_origin: z.string().optional(),
});

function getFieldValue(raw: unknown): string {
	if (raw && typeof raw === "object" && "value" in raw) {
		return String((raw as { value: unknown }).value ?? "");
	}
	return String(raw ?? "");
}

function extractOriginalName(description: string | undefined): string {
	if (!description) return "";
	const marker = "[smartprint-original-name]";
	const idx = description.toLowerCase().indexOf(marker.toLowerCase());
	if (idx < 0) return "";
	return description.slice(idx + marker.length).trim();
}

function buildHosts(connectOrigin: string | undefined): string[] {
	const defaults = [
		"https://web.connect.trimble.com",
		"https://app.connect.trimble.com",
		"https://app21.connect.trimble.com",
		"https://app31.connect.trimble.com",
	];
	const hosts = new Set<string>();
	if (connectOrigin?.trim()) hosts.add(connectOrigin.trim().replace(/\/$/, ""));
	for (const h of defaults) hosts.add(h);
	return [...hosts];
}

function buildUploadPaths(projectId: string, parentFolderId: string): string[] {
	return [
		`/tc/api/2.0/projects/${encodeURIComponent(projectId)}/files?parentId=${encodeURIComponent(parentFolderId)}`,
		`/tc/api/2.1/projects/${encodeURIComponent(projectId)}/files?parentId=${encodeURIComponent(parentFolderId)}`,
		`/tc/api/2.0/files?projectId=${encodeURIComponent(projectId)}&parentId=${encodeURIComponent(parentFolderId)}`,
		`/tc/api/2.1/files?projectId=${encodeURIComponent(projectId)}&parentId=${encodeURIComponent(parentFolderId)}`,
	];
}

async function tryUpload(
	accessToken: string,
	projectId: string,
	parentFolderId: string,
	targetName: string,
	file: MultipartFile,
	connectOrigin: string | undefined,
): Promise<{ fileId: string; versionId?: string }> {
	// Multipart streams are single-read; buffer once before trying hosts/paths.
	const bytes = await file.toBuffer();
	const blobBytes = new Uint8Array(bytes);
	const hosts = buildHosts(connectOrigin);
	const paths = buildUploadPaths(projectId, parentFolderId);
	const errors: string[] = [];
	for (const host of hosts) {
		for (const path of paths) {
			const endpoint = `${host}${path}`;
			try {
				const fd = new FormData();
				fd.append(
					"file",
					new Blob([blobBytes], { type: file.mimetype || "application/octet-stream" }),
					targetName,
				);
				fd.append("name", targetName);
				fd.append("parentId", parentFolderId);
				fd.append("projectId", projectId);
				const res = await fetch(endpoint, {
					method: "POST",
					headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
					body: fd,
				});
				if (!res.ok) {
					errors.push(`${res.status} at ${endpoint}`);
					continue;
				}
				const raw = (await res.json()) as Record<string, unknown>;
				const fileId =
					typeof raw.id === "string"
						? raw.id
						: typeof raw.fileId === "string"
							? raw.fileId
							: "";
				const versionId =
					typeof raw.versionId === "string" ? raw.versionId : undefined;
				if (!fileId) {
					errors.push(`missing file id at ${endpoint}`);
					continue;
				}
				return { fileId, versionId };
			} catch (error) {
				errors.push(`${error instanceof Error ? error.message : "request failed"} at ${endpoint}`);
			}
		}
	}
	throw new Error(`Upload failed on all endpoints. Attempts: ${errors.join(" | ")}`);
}

async function trySaveMetadata(
	accessToken: string,
	fileId: string,
	originalName: string,
	connectOrigin: string | undefined,
): Promise<boolean> {
	const hosts = buildHosts(connectOrigin);
	const payload = { description: `[smartprint-original-name] ${originalName}` };
	for (const host of hosts) {
		for (const path of [
			`/tc/api/2.0/files/${encodeURIComponent(fileId)}`,
			`/tc/api/2.1/files/${encodeURIComponent(fileId)}`,
		]) {
			for (const method of ["PATCH", "PUT"] as const) {
				try {
					const res = await fetch(`${host}${path}`, {
						method,
						headers: {
							Authorization: `Bearer ${accessToken}`,
							Accept: "application/json",
							"Content-Type": "application/json",
						},
						body: JSON.stringify(payload),
					});
					if (res.ok) return true;
				} catch {
					// Try next option.
				}
			}
		}
	}
	return false;
}

async function tryLoadVersions(
	accessToken: string,
	projectId: string,
	fileId: string,
	connectOrigin: string | undefined,
): Promise<VersionRow[]> {
	const hosts = buildHosts(connectOrigin);
	for (const host of hosts) {
		for (const path of [
			`/tc/api/2.0/files/${encodeURIComponent(fileId)}/versions?projectId=${encodeURIComponent(projectId)}`,
			`/tc/api/2.1/files/${encodeURIComponent(fileId)}/versions?projectId=${encodeURIComponent(projectId)}`,
		]) {
			try {
				const res = await fetch(`${host}${path}`, {
					headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
				});
				if (!res.ok) continue;
				const raw = (await res.json()) as Record<string, unknown>;
				const items =
					(raw.items as unknown[] | undefined) ??
					(raw.versions as unknown[] | undefined) ??
					(Array.isArray(raw) ? raw : []);
				if (!Array.isArray(items)) continue;
				return items
					.map((it) => it as Record<string, unknown>)
					.map((it) => {
						const description =
							typeof it.description === "string" ? it.description : undefined;
						return {
							fileId:
								typeof it.fileId === "string"
									? it.fileId
									: typeof it.id === "string"
										? it.id
										: "",
							versionId:
								typeof it.versionId === "string"
									? it.versionId
									: typeof it.id === "string"
										? it.id
										: undefined,
							name: typeof it.name === "string" ? it.name : "",
							description,
							updatedAt:
								typeof it.updatedAt === "string"
									? it.updatedAt
									: typeof it.modifiedAt === "string"
										? it.modifiedAt
										: undefined,
							originalName: extractOriginalName(description),
						} satisfies VersionRow;
					})
					.filter((x) => x.fileId);
			} catch {
				// Try next endpoint.
			}
		}
	}
	return [];
}

export function registerPostVersionUpload(rawApp: FastifyInstance): void {
	const app = rawApp.withTypeProvider<ZodTypeProvider>();
	app.post(
		"/integrations/trimble/version-upload",
		{
			schema: {
				tags: ["pdf-qr"],
				consumes: ["multipart/form-data"],
				description:
					"Uploads a file as a new Trimble version using target name and writes original local name in metadata.",
			},
		},
		async (request, reply) => {
			const body = request.body as Record<string, unknown>;
			const parsed = fieldSchema.safeParse({
				file: body.file,
				access_token: getFieldValue(body.access_token),
				project_id: getFieldValue(body.project_id),
				parent_folder_id: getFieldValue(body.parent_folder_id),
				target_name: getFieldValue(body.target_name),
				original_name: getFieldValue(body.original_name),
				connect_origin: getFieldValue(body.connect_origin) || undefined,
			});
			if (!parsed.success) {
				return reply.status(400).send({
					error: "Invalid multipart payload",
					details: parsed.error.flatten(),
				});
			}
			const fields = parsed.data;
			const upload = await tryUpload(
				fields.access_token,
				fields.project_id,
				fields.parent_folder_id,
				fields.target_name,
				fields.file,
				fields.connect_origin,
			);
			const metadataSaved = await trySaveMetadata(
				fields.access_token,
				upload.fileId,
				fields.original_name,
				fields.connect_origin,
			);
			const versions = await tryLoadVersions(
				fields.access_token,
				fields.project_id,
				upload.fileId,
				fields.connect_origin,
			);
			return reply.send({
				fileId: upload.fileId,
				versionId: upload.versionId,
				metadataSaved,
				versions,
			});
		},
	);
}

