/**
 * Resolves which Trimble Connect regional host answers for a project/folder.
 * Batch QR and version upload must use the same logic or uploads fail on non-default regions.
 */

import { fetchWithTimeout } from "../lib/fetch-with-timeout";

const PROBE_MS = 8_000;

export async function resolveProjectRegionHost(
	hosts: string[],
	accessToken: string,
	projectId: string,
): Promise<string[]> {
	const paths = [
		`/tc/api/2.0/projects/${encodeURIComponent(projectId)}`,
		`/tc/api/2.1/projects/${encodeURIComponent(projectId)}`,
		`/tc/api/2.0/projects?ids=${encodeURIComponent(projectId)}`,
		`/tc/api/2.1/projects?ids=${encodeURIComponent(projectId)}`,
	];
	for (const path of paths) {
		try {
			const host = await Promise.any(
				hosts.map(async (h) => {
					const res = await fetchWithTimeout(
						`${h}${path}`,
						{
							headers: {
								Authorization: `Bearer ${accessToken}`,
								Accept: "application/json",
							},
						},
						PROBE_MS,
					);
					if (!res.ok) throw new Error("not_ok");
					const ctype = (res.headers.get("content-type") || "").toLowerCase();
					if (!ctype.includes("application/json")) throw new Error("not_json");
					return h;
				}),
			);
			return [host, ...hosts.filter((h) => h !== host)];
		} catch {
			// try next path
		}
	}
	return hosts;
}

export async function resolvePreferredHosts(
	hosts: string[],
	accessToken: string,
	projectId: string,
	probeObjectId: string,
): Promise<string[]> {
	if (!probeObjectId.trim()) return hosts;
	const path = `/tc/api/2.0/tags?projectId=${encodeURIComponent(projectId)}&objectId=${encodeURIComponent(probeObjectId)}&objectType=FILE`;
	try {
		const host = await Promise.any(
			hosts.map(async (h) => {
				const res = await fetchWithTimeout(
					`${h}${path}`,
					{
						headers: {
							Authorization: `Bearer ${accessToken}`,
							Accept: "application/json",
						},
					},
					PROBE_MS,
				);
				if (!res.ok) throw new Error("not_ok");
				const ctype = (res.headers.get("content-type") || "").toLowerCase();
				if (!ctype.includes("application/json")) throw new Error("not_json");
				return h;
			}),
		);
		return [host, ...hosts.filter((h) => h !== host)];
	} catch {
		return hosts;
	}
}

/** Prefer the host that successfully lists the parent folder (same region as the file being versioned). */
export async function resolveHostsByFolderProbe(
	hosts: string[],
	accessToken: string,
	projectId: string,
	folderId: string,
): Promise<string[]> {
	const paths = [
		`/tc/api/2.1/folders/${encodeURIComponent(folderId)}/items?projectId=${encodeURIComponent(projectId)}`,
		`/tc/api/2.1/folders/${encodeURIComponent(folderId)}/items`,
		`/tc/api/folders/${encodeURIComponent(folderId)}/items`,
		`/tc/api/2.0/folders/${encodeURIComponent(folderId)}/items?projectId=${encodeURIComponent(projectId)}`,
	];
	for (const path of paths) {
		try {
			const host = await Promise.any(
				hosts.map(async (h) => {
					const res = await fetchWithTimeout(
						`${h}${path}`,
						{
							headers: {
								Authorization: `Bearer ${accessToken}`,
								Accept: "application/json",
							},
						},
						PROBE_MS,
					);
					if (!res.ok) throw new Error("not_ok");
					const ctype = (res.headers.get("content-type") || "").toLowerCase();
					if (!ctype.includes("application/json")) throw new Error("not_json");
					return h;
				}),
			);
			return [host, ...hosts.filter((h) => h !== host)];
		} catch {
			// try next path
		}
	}
	return hosts;
}
