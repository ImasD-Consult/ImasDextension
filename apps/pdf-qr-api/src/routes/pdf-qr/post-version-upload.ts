import type { MultipartFile } from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { buildTrimbleHosts, uploadFileToTrimbleFolder } from "../../services/trimble-fs-upload";
import {
	resolveHostsByFolderProbe,
	resolvePreferredHosts,
	resolveProjectRegionHost,
} from "../../services/trimble-host-resolution";

type VersionRow = {
	fileId: string;
	versionId?: string;
	name: string;
	description?: string;
	updatedAt?: string;
	originalName?: string;
};

function multipartTextOptional() {
	return z.preprocess((val) => {
		if (val === undefined || val === null) return undefined;
		if (typeof val === "object" && val !== null && "value" in val) {
			const s = String((val as { value: unknown }).value ?? "");
			return s === "" ? undefined : s;
		}
		const s = String(val);
		return s === "" ? undefined : s;
	}, z.string().optional());
}

const multipartFileFieldSchema = z
	.custom<MultipartFile>(
		(v): v is MultipartFile =>
			typeof v === "object" &&
			v !== null &&
			"mimetype" in v &&
			typeof (v as MultipartFile).toBuffer === "function",
	)
	.refine((f) => Boolean((f as MultipartFile).file), {
		message: "Missing file field `file`",
	});

const fieldSchema = z.object({
	file: multipartFileFieldSchema,
	access_token: z.string().min(1),
	project_id: z.string().min(1),
	parent_folder_id: z.string().min(1),
	target_name: z.string().min(1),
	original_name: z.string().min(1),
	connect_origin: z.string().optional(),
	/** Matched Trimble file id from the extension — pins the correct regional host. */
	probe_file_id: multipartTextOptional(),
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

async function tryUpload(
	accessToken: string,
	projectId: string,
	parentFolderId: string,
	targetName: string,
	file: MultipartFile,
	hosts: string[],
	/** When set, upload a new version of this file (avoids duplicate-name issues in the project). */
	existingFileId?: string,
): Promise<{ fileId: string; versionId?: string }> {
	const bytes = await file.toBuffer();
	const blobBytes = new Uint8Array(bytes);
	const contentType = file.mimetype || "application/octet-stream";
	const fileId = await uploadFileToTrimbleFolder(
		hosts,
		accessToken,
		projectId,
		parentFolderId,
		targetName,
		blobBytes,
		contentType,
		existingFileId,
	);
	return { fileId };
}

async function trySaveMetadata(
	accessToken: string,
	fileId: string,
	originalName: string,
	hosts: string[],
): Promise<boolean> {
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
	hosts: string[],
): Promise<VersionRow[]> {
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
			try {
				const body = request.body;
				if (!body || typeof body !== "object") {
					return reply.status(400).send({ error: "Missing multipart body" });
				}
				const b = body as Record<string, unknown>;
				const parsed = fieldSchema.safeParse({
					file: b.file,
					access_token: getFieldValue(b.access_token),
					project_id: getFieldValue(b.project_id),
					parent_folder_id: getFieldValue(b.parent_folder_id),
					target_name: getFieldValue(b.target_name),
					original_name: getFieldValue(b.original_name),
					connect_origin: getFieldValue(b.connect_origin) || undefined,
					probe_file_id: b.probe_file_id,
				});
				if (!parsed.success) {
					return reply.status(400).send({
						error: "Invalid multipart payload",
						details: parsed.error.flatten(),
					});
				}
				const fields = parsed.data;

				let hosts = buildTrimbleHosts(fields.connect_origin);
				hosts = await resolveProjectRegionHost(
					hosts,
					fields.access_token,
					fields.project_id,
				);
				hosts = await resolveHostsByFolderProbe(
					hosts,
					fields.access_token,
					fields.project_id,
					fields.parent_folder_id,
				);
				if (fields.probe_file_id?.trim()) {
					const preferred = await resolvePreferredHosts(
						hosts,
						fields.access_token,
						fields.project_id,
						fields.probe_file_id.trim(),
					);
					hosts = [hosts[0], ...preferred.filter((h) => h !== hosts[0])];
				}

				const upload = await tryUpload(
					fields.access_token,
					fields.project_id,
					fields.parent_folder_id,
					fields.target_name,
					fields.file,
					hosts,
					fields.probe_file_id?.trim() || undefined,
				);
				const metadataSaved = await trySaveMetadata(
					fields.access_token,
					upload.fileId,
					fields.original_name,
					hosts,
				);
				const versions = await tryLoadVersions(
					fields.access_token,
					fields.project_id,
					upload.fileId,
					hosts,
				);
				return reply.send({
					fileId: upload.fileId,
					versionId: upload.versionId,
					metadataSaved,
					versions,
				});
			} catch (err) {
				const message =
					err instanceof Error
						? err.message
						: typeof err === "string"
							? err
							: "Version upload failed";
				request.log.warn({ err }, "version_upload_failed");
				return reply.status(502).send({
					error: "trimble_upload_failed",
					message,
				});
			}
		},
	);
}
