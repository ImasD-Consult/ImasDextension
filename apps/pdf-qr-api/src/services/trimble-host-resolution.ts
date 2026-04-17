/**
 * Resolves which Trimble Connect regional host answers for a project/folder.
 * Batch QR and version upload must use the same logic or uploads fail on non-default regions.
 */

export async function resolveProjectRegionHost(
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
				return [host, ...hosts.filter((h) => h !== host)];
			} catch {
				// try next path/host
			}
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
			return [host, ...hosts.filter((h) => h !== host)];
		} catch {
			// try next host
		}
	}
	return hosts;
}

/** Prefer the host that successfully lists the parent folder (same region as the file being versioned). */
export async function resolveHostsByFolderProbe(
	hosts: string[],
	accessToken: string,
	projectId: string,
	folderId: string,
): Promise<string[]> {
	for (const host of hosts) {
		for (const path of [
			`/tc/api/2.1/folders/${encodeURIComponent(folderId)}/items?projectId=${encodeURIComponent(projectId)}`,
			`/tc/api/2.1/folders/${encodeURIComponent(folderId)}/items`,
			`/tc/api/folders/${encodeURIComponent(folderId)}/items`,
			`/tc/api/2.0/folders/${encodeURIComponent(folderId)}/items?projectId=${encodeURIComponent(projectId)}`,
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
				return [host, ...hosts.filter((h) => h !== host)];
			} catch {
				// try next
			}
		}
	}
	return hosts;
}
