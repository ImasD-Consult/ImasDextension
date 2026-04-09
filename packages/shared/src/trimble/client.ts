import type { TrimbleProject } from "trimble-connect-workspace-api";
import { TRIMBLE_REGIONS } from "./regions";
import type { TrimbleRegionId } from "./regions";

type ApiVersion = "2.0" | "2.1";

export interface TrimbleClientConfig {
	accessToken: string;
	region: TrimbleRegionId;
	useDevProxy?: boolean;
}

export interface TrimbleFolderItem {
	id: string;
	versionId?: string;
	name: string;
	type?: string;
}

export interface TrimbleModelTreeNode {
	id?: string | number;
	guid?: string;
	name?: string;
	type?: string;
	class?: string;
	frn?: string;
	link?: string;
	children?: TrimbleModelTreeNode[];
	[key: string]: unknown;
}

export class TrimbleApiError extends Error {
	override readonly name = "TrimbleApiError";

	constructor(
		public readonly status: number,
		public readonly body: string,
		public readonly url: string,
	) {
		super(`Trimble API ${status}: ${body}`);
	}
}

export class TrimbleClient {
	private readonly accessToken: string;
	private readonly region: TrimbleRegionId;
	private readonly useDevProxy: boolean;

	constructor(config: TrimbleClientConfig) {
		this.accessToken = config.accessToken;
		this.region = config.region;
		this.useDevProxy = config.useDevProxy ?? false;
	}

	private resolveBaseUrl(version: ApiVersion): string {
		if (this.useDevProxy) {
			const suffix = version === "2.1" ? "-21" : "";
			return `/tc-api-${this.region}${suffix}`;
		}
		return `${TRIMBLE_REGIONS[this.region].host}/tc/api/${version}`;
	}

	private async get<T>(version: ApiVersion, path: string): Promise<T> {
		const base = this.resolveBaseUrl(version);
		const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

		const res = await fetch(url, {
			headers: { Authorization: `Bearer ${this.accessToken}` },
		});

		if (!res.ok) {
			const text = await res.text();
			throw new TrimbleApiError(res.status, text || res.statusText, url);
		}

		return res.json();
	}

	async getProject(projectId: string): Promise<TrimbleProject> {
		try {
			return await this.get<TrimbleProject>(
				"2.1",
				`/projects/${encodeURIComponent(projectId)}`,
			);
		} catch {
			return this.get<TrimbleProject>(
				"2.0",
				`/projects/${encodeURIComponent(projectId)}?fullyLoaded=true`,
			);
		}
	}

	async getProjectRootId(projectId: string): Promise<string> {
		const project = await this.getProject(projectId);
		return (
			project.rootId ??
			project.rootFolderId ??
			project.rootFolderIdentifier ??
			projectId
		);
	}

	async listFolderItems(
		folderId: string,
		projectId?: string,
	): Promise<TrimbleFolderItem[] | null> {
		try {
			const data = await this.get<Record<string, unknown>>(
				"2.1",
				`/folders/${encodeURIComponent(folderId)}/items?pageSize=100`,
			);
			const items = (data?.items ?? data) as TrimbleFolderItem[];
			return Array.isArray(items) ? items : [];
		} catch {
			/* v2.1 failed — fall through to v2.0 */
		}

		try {
			const params = new URLSearchParams({ parentId: folderId });
			if (projectId) params.set("projectId", projectId);

			const data = await this.get<Record<string, unknown>>(
				"2.0",
				`/files?${params}`,
			);
			const items = (data?.items ??
				data?.files ??
				data?.children ??
				data) as TrimbleFolderItem[];
			return Array.isArray(items) ? items : [];
		} catch {
			return null;
		}
	}

	async getRootFolders(projectId: string): Promise<TrimbleFolderItem[]> {
		const rootId = await this.getProjectRootId(projectId);
		const items = await this.listFolderItems(rootId, projectId);
		if (!items) return [];
		return items.filter((item) => item.type?.toUpperCase() === "FOLDER");
	}

	async getModelTree(
		fileId: string,
		projectId?: string,
	): Promise<TrimbleModelTreeNode | TrimbleModelTreeNode[] | null> {
		const params = new URLSearchParams();
		if (projectId) params.set("projectId", projectId);
		params.set("depth", "-1");
		const query = params.toString() ? `?${params.toString()}` : "";
		try {
			return await this.get<TrimbleModelTreeNode | TrimbleModelTreeNode[]>(
				"2.0",
				`/model/${encodeURIComponent(fileId)}/tree${query}`,
			);
		} catch {
			return null;
		}
	}
}
