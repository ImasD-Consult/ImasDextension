import { TrimbleClient, TRIMBLE_REGIONS } from "@imasd/shared/trimble";
import type { WorkspaceApi } from "@imasd/shared/trimble";
import { resolveViewerModelsForWbs } from "./viewer-model";

export interface FolderItem {
	id: string;
	name: string;
}

export interface FolderResult {
	items: FolderItem[];
	source: "api" | "viewer";
}

export async function fetchProjectFolders(
	api: WorkspaceApi,
): Promise<FolderResult> {
	const project = await api.project.getProject();
	if (!project?.id) {
		throw new Error("No project selected.");
	}

	const token = await api.extension.requestPermission("accesstoken");
	if (token === "denied" || token === "pending") {
		throw new Error(
			`Access token ${token}. Please grant permission in extension settings.`,
		);
	}

	const client = new TrimbleClient({
		accessToken: token,
		region: "eu",
		useDevProxy: import.meta.env.DEV,
	});

	const folders = await client.getRootFolders(project.id);
	if (folders.length > 0) {
		return {
			items: folders.map((f) => ({
				id: f.id || f.versionId || "",
				name: f.name,
			})),
			source: "api",
		};
	}

	if (api.viewer?.getModels) {
		const models = await api.viewer.getModels();
		if (models?.length) {
			return {
				items: models.map((m) => ({
					id: m.id || m.versionId || "",
					name: m.name || "Model",
				})),
				source: "viewer",
			};
		}
	}

	throw new Error(
		"Could not load folders. Use the Data view (left panel) to browse smartprintPRO.",
	);
}

const SMARTPRINT_FOLDER_NAMES = [
	"smartprintpro",
	"smartprintfolderpro",
	"smartprint folder pro",
];

function matchesSmartprintFolder(name: string): boolean {
	const lower = name?.toLowerCase().replace(/\s+/g, "") ?? "";
	return SMARTPRINT_FOLDER_NAMES.some(
		(n) => lower === n.toLowerCase().replace(/\s+/g, ""),
	);
}

export async function fetchSmartprintFolderProSubfolders(
	api: WorkspaceApi,
): Promise<FolderResult> {
	const project = await api.project.getProject();
	if (!project?.id) {
		throw new Error("No project selected.");
	}

	const token = await api.extension.requestPermission("accesstoken");
	if (token === "denied" || token === "pending") {
		throw new Error(
			`Access token ${token}. Please grant permission in extension settings.`,
		);
	}

	const client = new TrimbleClient({
		accessToken: token,
		region: "eu",
		useDevProxy: import.meta.env.DEV,
	});

	const rootFolders = await client.getRootFolders(project.id);
	const smartprintFolder = rootFolders.find((f) =>
		matchesSmartprintFolder(f.name ?? ""),
	);

	if (smartprintFolder) {
		const items = await client.listFolderItems(
			smartprintFolder.id || smartprintFolder.versionId || "",
			project.id,
		);

		if (items?.length) {
			const subfolders = items.filter(
				(item) => item.type?.toUpperCase() === "FOLDER",
			);
			if (subfolders.length > 0) {
				return {
					items: subfolders.map((f) => ({
						id: f.id || f.versionId || "",
						name: f.name,
					})),
					source: "api",
				};
			}
		}
	}

	// Fallback: show root folders (original behavior when smartprintfolderpro missing or empty)
	if (rootFolders.length > 0) {
		return {
			items: rootFolders.map((f) => ({
				id: f.id || f.versionId || "",
				name: f.name,
			})),
			source: "api",
		};
	}

	// Last resort: viewer models (e.g. when API returns empty in some contexts)
	if (api.viewer?.getModels) {
		const models = await api.viewer.getModels();
		if (models?.length) {
			return {
				items: models.map((m) => ({
					id: m.id || m.versionId || "",
					name: m.name || "Model",
				})),
				source: "viewer",
			};
		}
	}

	return { items: [], source: "api" };
}

export interface AssemblyItem {
	id: string;
	versionId?: string;
	name: string;
}

export interface IfcModelItem {
	id: string;
	versionId?: string;
	name: string;
}

export interface IfcAssemblyItem {
	id: string;
	name: string;
	type: string;
	material: string;
	link?: string;
}

const IFC_EXTENSIONS = [".ifc", ".ifczip", ".ifcxml"];

function isIfcFile(name: string): boolean {
	const lower = name?.toLowerCase() ?? "";
	return IFC_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

type SmartprintProWindow = Window & {
	__SMARTPRINT_PRO__?: {
		EXTENSION_URL?: string;
		TRIMBLE_CONNECT_ORIGIN?: string;
	};
};

/** Injected at container startup by docker-entrypoint.sh (`env.js`) so Compose can set region without rebuild. */
function getRuntimeTrimbleConnectOrigin(): string | undefined {
	if (typeof window === "undefined") return undefined;
	const o = (window as SmartprintProWindow).__SMARTPRINT_PRO__?.TRIMBLE_CONNECT_ORIGIN?.trim();
	return o ? o.replace(/\/$/, "") : undefined;
}

/**
 * Base URLs for `/tc/api/...` (model tree, files, etc.).
 *
 * When the extension runs on a custom host (e.g. extensions.imasd.dev), relative `/tc/api` does
 * not hit Trimble. Order of preference:
 * 1. Runtime `TRIMBLE_CONNECT_ORIGIN` / `VITE_TRIMBLE_CONNECT_ORIGIN` from `env.js` (Docker Compose)
 * 2. `import.meta.env.VITE_TRIMBLE_CONNECT_ORIGIN` (Vite build-time)
 * 3. `window.location.ancestorOrigins` / `document.referrer` when the parent is `*.connect.trimble.com`
 * 4. Known regional hosts (NA / EU / Asia) — last resort; wrong shard ⇒ missing file or empty tree
 *
 * In Folders-only mode there is no 3D viewer context; explicit origin + correct region matters more.
 */
function getConnectTrimbleBaseUrls(): string[] {
	const bases = new Set<string>();
	const runtime = getRuntimeTrimbleConnectOrigin();
	if (runtime) {
		bases.add(runtime);
	}
	const env = (
		import.meta as ImportMeta & {
			env?: { VITE_TRIMBLE_CONNECT_ORIGIN?: string };
		}
	).env?.VITE_TRIMBLE_CONNECT_ORIGIN;
	if (env?.trim()) {
		bases.add(env.replace(/\/$/, ""));
	}

	if (typeof window !== "undefined" && window.location.ancestorOrigins?.length) {
		for (let i = 0; i < window.location.ancestorOrigins.length; i++) {
			try {
				const { origin, hostname } = new URL(window.location.ancestorOrigins[i]);
				if (/connect\.trimble\.com$/i.test(hostname)) {
					bases.add(origin);
				}
			} catch {
				/* ignore invalid ancestor URL */
			}
		}
	}

	// When ancestorOrigins is missing (some browsers), the embedding Connect tab is often in referrer.
	if (typeof document !== "undefined" && document.referrer) {
		try {
			const { origin, hostname } = new URL(document.referrer);
			if (/connect\.trimble\.com$/i.test(hostname)) {
				bases.add(origin);
			}
		} catch {
			/* ignore */
		}
	}

	for (const r of Object.values(TRIMBLE_REGIONS)) {
		bases.add(r.host);
	}

	return [...bases];
}

export async function fetchProjectIfcModels(
	api: WorkspaceApi,
): Promise<IfcModelItem[]> {
	const project = await api.project.getProject();
	if (!project?.id) {
		throw new Error("No project selected.");
	}

	const token = await api.extension.requestPermission("accesstoken");
	if (token === "denied" || token === "pending") {
		throw new Error(
			`Access token ${token}. Please grant permission in extension settings.`,
		);
	}

	const client = new TrimbleClient({
		accessToken: token,
		region: "eu",
		useDevProxy: import.meta.env.DEV,
	});

	const rootId = await client.getProjectRootId(project.id);
	const queue: string[] = [rootId];
	const visited = new Set<string>();
	const ifcFiles: IfcModelItem[] = [];
	const seenIfcIds = new Set<string>();

	// Safety cap to avoid unbounded scans on very large projects.
	const MAX_FOLDERS_TO_SCAN = 5000;
	let scannedFolders = 0;

	while (queue.length > 0 && scannedFolders < MAX_FOLDERS_TO_SCAN) {
		const folderId = queue.shift();
		if (!folderId || visited.has(folderId)) continue;
		visited.add(folderId);
		scannedFolders += 1;

		const items = await client.listFolderItems(folderId, project.id);
		if (!items?.length) continue;

		for (const item of items) {
			const itemId = item.id || item.versionId || "";
			const isFolder = item.type?.toUpperCase() === "FOLDER";

			if (isFolder && itemId) {
				queue.push(itemId);
				continue;
			}

			if (!isIfcFile(item.name ?? "")) continue;
			if (!itemId || seenIfcIds.has(itemId)) continue;

			seenIfcIds.add(itemId);
			ifcFiles.push({
				id: item.id || item.versionId || "",
				versionId: item.versionId,
				name: item.name ?? "Unknown IFC",
			});
		}
	}

	return ifcFiles;
}

function readNodeString(
	node: Record<string, unknown>,
	keys: string[],
): string | undefined {
	for (const key of keys) {
		const value = node[key];
		if (typeof value === "string" && value.trim().length > 0) return value;
	}
	return undefined;
}

function readNodeChildren(node: Record<string, unknown>): unknown[] {
	const arrayKeys = [
		"children",
		"items",
		"nodes",
		"entities",
		"elements",
		"members",
	];
	for (const key of arrayKeys) {
		const candidate = node[key];
		if (Array.isArray(candidate)) return candidate;
	}
	// Common single-child wrappers from Connect / model APIs (treeWalkCount & validation)
	const objectKeys = [
		"tree",
		"data",
		"model",
		"hierarchy",
		"root",
		"result",
		"value",
	];
	for (const key of objectKeys) {
		const v = node[key];
		if (v != null && typeof v === "object") {
			return Array.isArray(v) ? v : [v];
		}
	}
	return [];
}

function collectIfcAssembliesFromTree(tree: unknown, acc: IfcAssemblyItem[], seen: Set<string>): void {
	if (!tree || typeof tree !== "object") return;
	const node = tree as Record<string, unknown>;

	const classOrType =
		readNodeString(node, ["class", "type", "entityType", "ifcClass", "category"]) ?? "";
	const normalized = classOrType.toLowerCase().replace(/[\s_-]+/g, "");
	const isAssemblyNode =
		normalized.includes("ifcelementassembly") ||
		normalized === "assembly" ||
		normalized.endsWith("assembly");
	const guidLikeId =
		readNodeString(node, ["guid", "globalId", "globalid", "fileId", "fileid", "entityId", "entityid"]) ??
		"";
	const stableEntityLink =
		guidLikeId &&
		!/^\d+$/.test(guidLikeId.trim()) &&
		guidLikeId.trim().length >= 4
			? `frn:entity:${guidLikeId.trim()}`
			: undefined;
	if (isAssemblyNode) {
		const id =
			readNodeString(node, ["guid", "id", "runtimeId", "entityId"]) ??
			`assembly-${acc.length + 1}`;
		if (!seen.has(id)) {
			seen.add(id);
			acc.push({
				id,
				name: readNodeString(node, ["name", "label"]) ?? `Assembly ${id}`,
				type: "IFCELEMENTASSEMBLY",
				material: "Unknown",
				link: readNodeString(node, ["frn", "link"]) ?? stableEntityLink,
			});
		}
	}

	// Walk explicit child collections first
	for (const child of readNodeChildren(node)) {
		collectIfcAssembliesFromTree(child, acc, seen);
	}

	// Also walk any nested objects/arrays to handle variant payload structures.
	for (const value of Object.values(node)) {
		if (!value) continue;
		if (Array.isArray(value)) {
			for (const item of value) {
				if (item && typeof item === "object") {
					collectIfcAssembliesFromTree(item, acc, seen);
				}
			}
		} else if (typeof value === "object") {
			collectIfcAssembliesFromTree(value, acc, seen);
		}
	}
}

function collectAllObjectNodesFromTree(
	tree: unknown,
	acc: IfcAssemblyItem[],
	seen: Set<string>,
): void {
	if (!tree || typeof tree !== "object") return;
	const node = tree as Record<string, unknown>;
	const id = readNodeString(node, ["guid", "id", "runtimeId", "entityId"]);
	const classOrType =
		readNodeString(node, ["class", "type", "entityType", "ifcClass", "category"]) ??
		"UNKNOWN";
	const name = readNodeString(node, ["name", "label"]);
	const stableEntityCandidate =
		readNodeString(node, ["guid", "globalId", "globalid", "fileId", "fileid", "entityId", "entityid"]) ??
		"";
	const stableEntityLink =
		stableEntityCandidate &&
		!/^\d+$/.test(stableEntityCandidate.trim()) &&
		stableEntityCandidate.trim().length >= 4
			? `frn:entity:${stableEntityCandidate.trim()}`
			: undefined;

	if (id && !seen.has(id)) {
		seen.add(id);
		acc.push({
			id,
			name: name ?? `${classOrType} ${id}`,
			type: classOrType.toUpperCase(),
			material: "Unknown",
			link: readNodeString(node, ["frn", "link"]) ?? stableEntityLink,
		});
	}

	for (const child of readNodeChildren(node)) {
		collectAllObjectNodesFromTree(child, acc, seen);
	}
	for (const value of Object.values(node)) {
		if (!value) continue;
		if (Array.isArray(value)) {
			for (const item of value) {
				if (item && typeof item === "object") {
					collectAllObjectNodesFromTree(item, acc, seen);
				}
			}
		} else if (typeof value === "object") {
			collectAllObjectNodesFromTree(value, acc, seen);
		}
	}
}

function treeWalkCount(node: unknown): number {
	if (node == null) return 0;
	if (Array.isArray(node)) {
		return node.reduce((sum, n) => sum + treeWalkCount(n), 0);
	}
	if (typeof node !== "object") return 0;
	const o = node as Record<string, unknown>;
	let count = 1;
	for (const child of readNodeChildren(o)) {
		count += treeWalkCount(child);
	}
	return count;
}

/**
 * Core API often wraps the tree as { tree }, { data }, or puts roots in items[].
 * Without unwrapping, validation sees a single empty shell and rejects a valid payload.
 */
function unwrapModelTreePayload(data: unknown): unknown {
	if (data == null) return data;
	if (Array.isArray(data)) return data;
	if (typeof data !== "object") return data;
	const o = data as Record<string, unknown>;
	if (Array.isArray(o.items) && o.items.length > 0) return o.items;
	if (Array.isArray(o.models) && o.models.length > 0) return o.models;
	if (Array.isArray(o.nodes) && o.nodes.length > 0) return o.nodes;
	for (const k of [
		"tree",
		"model",
		"hierarchy",
		"result",
		"value",
		"data",
	]) {
		const v = o[k];
		if (v != null && typeof v === "object") {
			return unwrapModelTreePayload(v);
		}
	}
	return data;
}

/** Reject empty 200 bodies (e.g. `{}`) that are not a real model tree. */
function isUsableTreeResponse(data: unknown): boolean {
	const payload = unwrapModelTreePayload(data);
	if (payload == null) return false;
	if (Array.isArray(payload)) return payload.length > 0;
	if (typeof payload !== "object") return false;
	const o = payload as Record<string, unknown>;
	if (Object.keys(o).length === 0) return false;
	const wc = treeWalkCount(payload);
	if (wc > 1) return true;
	if (wc === 1) {
		const hasId =
			readNodeString(o, ["guid", "id", "runtimeId", "entityId"])?.length ?? 0;
		return hasId > 0;
	}
	return false;
}

function readStringProp(
	obj: Record<string, unknown>,
	key: string,
): string | undefined {
	const v = obj[key];
	return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/** Only well-known file / version / model fields — avoids nested "status" false positives (e.g. PROCESSING). */
function getFileProcessingStateShallow(
	fileObj: Record<string, unknown> | null,
): string {
	if (!fileObj) return "unknown";
	const direct =
		readStringProp(fileObj, "processingState") ??
		readStringProp(fileObj, "processingStatus") ??
		readStringProp(fileObj, "conversionStatus") ??
		readStringProp(fileObj, "modelProcessingState");
	if (direct) return direct;

	const lv = fileObj.latestVersion;
	if (lv && typeof lv === "object") {
		const lvo = lv as Record<string, unknown>;
		const fromLv =
			readStringProp(lvo, "processingState") ??
			readStringProp(lvo, "processingStatus") ??
			readStringProp(lvo, "conversionStatus");
		if (fromLv) return fromLv;
	}

	const model = fileObj.model;
	if (model && typeof model === "object") {
		const mo = model as Record<string, unknown>;
		const fromM =
			readStringProp(mo, "processingState") ??
			readStringProp(mo, "processingStatus") ??
			readStringProp(mo, "conversionStatus");
		if (fromM) return fromM;
	}

	return "unknown";
}

function extractModelIdsFromFileRecord(
	fileObj: Record<string, unknown> | null,
): string[] {
	if (!fileObj) return [];
	const out: string[] = [];
	const pick = (o: Record<string, unknown>) => {
		for (const k of ["modelId", "bimModelId", "linkedModelId"]) {
			const v = o[k];
			if (typeof v === "string" && v.trim().length > 0) out.push(v.trim());
		}
	};
	pick(fileObj);
	const lv = fileObj.latestVersion;
	if (lv && typeof lv === "object") pick(lv as Record<string, unknown>);
	const model = fileObj.model;
	if (model && typeof model === "object") pick(model as Record<string, unknown>);
	return [...new Set(out)];
}

function uniqStrings(ids: (string | undefined)[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const id of ids) {
		if (typeof id === "string" && id.length > 0 && !seen.has(id)) {
			seen.add(id);
			out.push(id);
		}
	}
	return out;
}

export type FetchIfcPartsOptions = {
	/**
	 * When true (default), include all IFC entities from the viewer / model tree,
	 * not only IFCELEMENTASSEMBLY.
	 */
	listAllIfcObjects?: boolean;
	/**
	 * Prefer persistent GUID/entity-id extraction from model-tree REST payloads.
	 * When true, skips viewer-hierarchy fast path that can return runtime-only ids.
	 */
	preferStableEntityIds?: boolean;
};

export async function fetchIfcAssembliesFromFile(
	api: WorkspaceApi,
	ifcFileId: string,
	ifcVersionId?: string,
	ifcDisplayName?: string,
	options?: FetchIfcPartsOptions,
): Promise<IfcAssemblyItem[]> {
	const listAllIfcObjects = options?.listAllIfcObjects !== false;
	const preferStableEntityIds = options?.preferStableEntityIds === true;
	function countStableLinks(items: IfcAssemblyItem[]): number {
		return items.filter((item) => {
			const l = item.link?.trim() ?? "";
			return l.startsWith("frn:") && l.length > 8;
		}).length;
	}

	const project = await api.project.getProject();
	if (!project?.id) {
		throw new Error("No project selected.");
	}

	const token = await api.extension.requestPermission("accesstoken");
	if (token === "denied" || token === "pending") {
		throw new Error(
			`Access token ${token}. Please grant permission in extension settings.`,
		);
	}

	async function fetchJsonWithTimeout(
		url: string,
		timeoutMs = 4500,
	): Promise<unknown | null> {
		const controller = new AbortController();
		const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetch(url, {
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/json",
					"Content-Type": "application/json",
				},
				signal: controller.signal,
			});
			if (!response.ok) return null;
			return response.json();
		} catch {
			return null;
		} finally {
			window.clearTimeout(timeoutId);
		}
	}

	function buildModelTreePaths(encoded: string, projectIdEnc: string): string[] {
		return [
			`/tc/api/2.0/model/${encoded}/tree?projectId=${projectIdEnc}&depth=-1`,
			`/tc/api/2.0/model/${encoded}/tree?depth=-1`,
			`/tc/api/2.1/model/${encoded}/tree?projectId=${projectIdEnc}&depth=-1`,
			`/tc/api/2.1/model/${encoded}/tree?depth=-1`,
			`/tc/api/2.0/projects/${projectIdEnc}/models/${encoded}/hierarchies?depth=-1&hierarchyType=assembly`,
			`/tc/api/2.0/projects/${projectIdEnc}/models/${encoded}/hierarchies?depth=-1`,
			`/tc/api/2.0/projects/${projectIdEnc}/model/${encoded}/tree?depth=-1`,
		];
	}

	function expandToAbsoluteUrls(paths: string[]): string[] {
		const out: string[] = [];
		const seen = new Set<string>();
		for (const base of getConnectTrimbleBaseUrls()) {
			for (const p of paths) {
				const u = `${base}${p}`;
				if (!seen.has(u)) {
					seen.add(u);
					out.push(u);
				}
			}
		}
		for (const p of paths) {
			if (!seen.has(p)) {
				seen.add(p);
				out.push(p);
			}
		}
		return out;
	}

	async function getModelTreeById(
		fileOrVersionId: string,
	): Promise<unknown | null> {
		const encoded = encodeURIComponent(fileOrVersionId);
		const projectIdEnc = encodeURIComponent(project.id);
		const paths = buildModelTreePaths(encoded, projectIdEnc);
		const urls = expandToAbsoluteUrls(paths);
		const results = await Promise.all(
			urls.map((url) => fetchJsonWithTimeout(url, 5500)),
		);
		for (let i = 0; i < results.length; i++) {
			const item = results[i];
			if (item !== null && isUsableTreeResponse(item)) {
				return unwrapModelTreePayload(item);
			}
		}
		return null;
	}

	async function getFileInfoById(fileOrVersionId: string): Promise<unknown | null> {
		const encoded = encodeURIComponent(fileOrVersionId);
		const paths = [
			`/tc/api/2.0/projects/${encodeURIComponent(project.id)}/files/${encoded}`,
			`/tc/api/2.0/files/${encoded}?projectId=${encodeURIComponent(project.id)}`,
			`/tc/api/2.0/files/${encoded}`,
		];
		const urls = expandToAbsoluteUrls(paths);
		const results = await Promise.all(
			urls.map((url) => fetchJsonWithTimeout(url, 4500)),
		);
		return results.find((item) => item !== null) ?? null;
	}

	function analyzeTree(treeValue: unknown): {
		nodeCount: number;
		classSamples: string[];
	} {
		const classCounter = new Map<string, number>();
		let nodeCount = 0;

		function walk(nodeValue: unknown): void {
			if (!nodeValue || typeof nodeValue !== "object") return;
			const node = nodeValue as Record<string, unknown>;
			nodeCount += 1;
			const classOrType =
				readNodeString(node, [
					"class",
					"type",
					"entityType",
					"ifcClass",
					"category",
				]) ?? "";
			if (classOrType) {
				classCounter.set(classOrType, (classCounter.get(classOrType) ?? 0) + 1);
			}

			for (const child of readNodeChildren(node)) {
				walk(child);
			}
			for (const value of Object.values(node)) {
				if (Array.isArray(value)) {
					for (const item of value) walk(item);
				} else if (value && typeof value === "object") {
					walk(value);
				}
			}
		}

		if (Array.isArray(treeValue)) {
			for (const root of treeValue) walk(root);
		} else {
			walk(treeValue);
		}

		const classSamples = [...classCounter.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([name, count]) => `${name} (${count})`);

		return { nodeCount, classSamples };
	}

	type ViewerModelLike = {
		id: string;
		versionId?: string;
		name?: string;
	};

	function collectMatchingViewerModels(
		models: ViewerModelLike[],
	): ViewerModelLike[] {
		const fileNameNorm = (ifcDisplayName ?? "").toLowerCase().trim();
		const matched: ViewerModelLike[] = [];
		for (const m of models) {
			const nameNorm = (m.name ?? "").toLowerCase().trim();
			const matchById =
				m.id === ifcFileId ||
				m.versionId === ifcVersionId ||
				m.versionId === ifcFileId ||
				m.id === ifcVersionId;
			const matchByName =
				fileNameNorm.length > 0 &&
				nameNorm.length > 0 &&
				(nameNorm === fileNameNorm ||
					nameNorm.endsWith(fileNameNorm) ||
					fileNameNorm.endsWith(nameNorm));
			if (matchById || matchByName) matched.push(m);
		}
		if (matched.length === 0 && models.length === 1) return [models[0]];
		return matched;
	}

	const ROOT_ENTITY_TRY = [0, 1];
	const MAX_VIEWER_OBJECTS_FALLBACK = 4000;

	function viewerModelIdCandidates(primary: ViewerModelLike): string[] {
		return uniqStrings([primary.id, primary.versionId]);
	}

	function mapHierarchyEntitiesToParts(
		entities: Array<{ id: number; name: string; fileId?: string }>,
		partType: string,
	): IfcAssemblyItem[] {
		const seen = new Set<string>();
		const out: IfcAssemblyItem[] = [];
		for (const e of entities) {
			const key = String(e.id);
			if (seen.has(key)) continue;
			seen.add(key);
			out.push({
				id: key,
				name: e.name?.trim() || `Object ${key}`,
				type: partType,
				material: "Unknown",
				link:
					typeof e.fileId === "string" && e.fileId.trim()
						? `frn:entity:${e.fileId.trim()}`
						: undefined,
			});
		}
		return out;
	}

	/**
	 * `getHierarchyChildren` expects parent entity IDs — `[]` returns nothing. Try roots 0/1,
	 * ElementAssembly (4) first, then other hierarchies; use both `id` and `versionId` as modelId.
	 */
	async function tryFetchViaHierarchyChildren(
		primary: ViewerModelLike,
	): Promise<IfcAssemblyItem[] | null> {
		const viewer = api.viewer;
		if (!viewer?.getHierarchyChildren) return null;
		const fetchChildren = viewer.getHierarchyChildren;

		const modelIds = viewerModelIdCandidates(primary);

		async function runForTypes(
			hTypes: number[],
			partType: string,
		): Promise<IfcAssemblyItem[] | null> {
			for (const mid of modelIds) {
				if (!mid) continue;
				for (const hType of hTypes) {
					for (const rootId of ROOT_ENTITY_TRY) {
						try {
							const entities = await fetchChildren(
								mid,
								[rootId],
								hType,
								true,
							);
							if (entities?.length) {
								return mapHierarchyEntitiesToParts(entities, partType);
							}
						} catch {
							/* try next combination */
						}
					}
				}
			}
			return null;
		}

		const assemblyHierarchy = await runForTypes([4], "IFCELEMENTASSEMBLY");
		if (assemblyHierarchy?.length) return assemblyHierarchy;

		const otherHierarchy = await runForTypes(
			[1, 3, 5, 6, 2],
			"VIEWER_HIERARCHY",
		);
		if (otherHierarchy?.length) return otherHierarchy;

		return null;
	}

	type ParsedViewerObject = {
		runtimeId: number;
		name?: string;
		classHint?: string;
		link?: string;
		entityKey?: string;
	};

	function collectObjectsFromModelObjectsEntry(
		mo: Record<string, unknown>,
	): ParsedViewerObject[] {
		const raw = mo.objects;
		const out: ParsedViewerObject[] = [];

		if (Array.isArray(raw)) {
			for (const item of raw) {
				if (typeof item === "number") {
					out.push({ runtimeId: item });
					continue;
				}
				if (item && typeof item === "object") {
					const it = item as Record<string, unknown>;
					const rid =
						typeof it.objectRuntimeId === "number"
							? it.objectRuntimeId
							: typeof it.id === "number"
								? it.id
								: typeof it.runtimeId === "number"
									? it.runtimeId
									: null;
					if (rid == null) continue;
					const name =
						typeof it.name === "string"
							? it.name
							: typeof it.displayName === "string"
								? it.displayName
								: undefined;
					const classHint =
						typeof it.class === "string"
							? it.class
							: typeof it.type === "string"
								? it.type
								: undefined;
					const frnLink =
						typeof it.frn === "string" && it.frn.trim()
							? it.frn.trim()
							: typeof it.link === "string" && it.link.trim()
								? it.link.trim()
								: undefined;
					const entityCandidate =
						typeof it.fileId === "string" && it.fileId.trim()
							? it.fileId.trim()
							: typeof it.guid === "string" && it.guid.trim()
								? it.guid.trim()
								: typeof it.globalId === "string" && it.globalId.trim()
									? it.globalId.trim()
									: undefined;
					out.push({
						runtimeId: rid,
						name,
						classHint,
						link: frnLink,
						entityKey:
							entityCandidate &&
							!/^\d+$/.test(entityCandidate) &&
							entityCandidate.length >= 10
								? entityCandidate
								: undefined,
					});
				}
			}
			return out;
		}

		if (raw && typeof raw === "object") {
			const nested = raw as Record<string, unknown>;
			const rids = nested.objectRuntimeIds;
			if (Array.isArray(rids)) {
				for (const rid of rids) {
					if (typeof rid === "number") {
						out.push({ runtimeId: rid });
					}
				}
			}
		}
		return out;
	}

	/**
	 * Pull human-readable labels from nested viewer property payloads (IFC Name, Tag, Product Name, etc.).
	 */
	function extractDisplayNameAndMaterialFromProps(
		root: unknown,
	): { displayName?: string; material?: string; entityKey?: string } {
		let productName: string | undefined;
		let objectName: string | undefined;
		let genericName: string | undefined;
		let tag: string | undefined;
		let material: string | undefined;
		let entityKey: string | undefined;

		function considerPair(keyRaw: string, value: unknown): void {
			if (typeof value !== "string") return;
			const v = value.trim();
			if (!v) return;
			const k = keyRaw.trim().toLowerCase().replace(/\s+/g, " ");
			if (!entityKey) {
				const entityKeyNames = new Set([
					"guid",
					"globalid",
					"global id",
					"fileid",
					"file id",
					"entity guid",
					"entityguid",
					"entity id",
				]);
				if (entityKeyNames.has(k) && !/^\d+$/.test(v) && v.length >= 10) {
					entityKey = v;
				}
			}
			if (k === "product name" || k === "productname") {
				if (!productName) productName = v;
				return;
			}
			if (k === "object name" || k === "objectname") {
				if (!objectName) objectName = v;
				return;
			}
			if (k === "name" && !genericName) {
				genericName = v;
				return;
			}
			if ((k === "tag" || k === "ifc tag" || k === "item tag") && !tag) {
				tag = v;
				return;
			}
			if (!material) {
				if (
					k === "material" ||
					k === "material name" ||
					k === "main material" ||
					k === "constituent material" ||
					k === "physical material"
				) {
					material = v;
				}
			}
		}

		function walk(node: unknown, depth: number): void {
			if (depth > 14 || node == null) return;
			if (Array.isArray(node)) {
				for (const item of node) {
					if (item && typeof item === "object") {
						const o = item as Record<string, unknown>;
						const nameKey =
							(typeof o.name === "string" && o.name) ||
							(typeof o.displayName === "string" && o.displayName) ||
							(typeof o.propertyName === "string" && o.propertyName) ||
							(typeof o.key === "string" && o.key);
						const val =
							o.value ??
							o.stringValue ??
							o.displayValue ??
							(typeof o.nominalValue === "string" ? o.nominalValue : undefined);
						if (nameKey && typeof val === "string") {
							considerPair(nameKey, val);
						}
					}
					walk(item, depth + 1);
				}
				return;
			}
			if (typeof node === "object") {
				const o = node as Record<string, unknown>;
				for (const [k, v] of Object.entries(o)) {
					if (typeof v === "string") considerPair(k, v);
					else walk(v, depth + 1);
				}
			}
		}

		walk(root, 0);
		const displayName =
			productName ?? objectName ?? genericName ?? tag;
		return { displayName, material, entityKey };
	}

	async function enrichPartsFromObjectProperties(
		modelId: string,
		parts: IfcAssemblyItem[],
	): Promise<IfcAssemblyItem[]> {
		const viewer = api.viewer;
		if (!viewer?.getObjectProperties || parts.length === 0) return parts;

		const runtimeIds = parts
			.map((p) => Number(p.id))
			.filter((n) => !Number.isNaN(n));
		if (runtimeIds.length === 0) return parts;

		const BATCH = 120;
		const classByRuntime = new Map<number, string>();
		const displayNameByRuntime = new Map<number, string>();
		const materialByRuntime = new Map<number, string>();
		const linkByRuntime = new Map<number, string>();

		for (let i = 0; i < runtimeIds.length; i += BATCH) {
			const chunk = runtimeIds.slice(i, i + BATCH);
			try {
				const props = await viewer.getObjectProperties(modelId, chunk);
				if (!Array.isArray(props)) continue;
				for (let j = 0; j < chunk.length; j++) {
					const pr = props[j];
					if (!pr || typeof pr !== "object") continue;
					const po = pr as Record<string, unknown>;
					const ridRaw = po.id;
					const rid =
						typeof ridRaw === "number" && !Number.isNaN(ridRaw)
							? ridRaw
							: chunk[j];
					const stableIdFromTopLevel =
						typeof po.id === "string" && po.id.trim()
							? po.id.trim()
							: typeof po.entityId === "string" && po.entityId.trim()
								? po.entityId.trim()
								: undefined;
					if (
						stableIdFromTopLevel &&
						!/^\d+$/.test(stableIdFromTopLevel) &&
						stableIdFromTopLevel.length >= 10
					) {
						linkByRuntime.set(rid, `frn:entity:${stableIdFromTopLevel}`);
					}
					const topLink =
						typeof po.frn === "string" && po.frn.trim()
							? po.frn.trim()
							: typeof po.link === "string" && po.link.trim()
								? po.link.trim()
								: undefined;
					if (topLink) {
						linkByRuntime.set(rid, topLink);
					}
					const topEntityCandidate =
						typeof po.fileId === "string" && po.fileId.trim()
							? po.fileId.trim()
							: typeof po.guid === "string" && po.guid.trim()
								? po.guid.trim()
								: typeof po.globalId === "string" && po.globalId.trim()
									? po.globalId.trim()
									: undefined;
					if (
						topEntityCandidate &&
						!/^\d+$/.test(topEntityCandidate) &&
						topEntityCandidate.length >= 10
					) {
						linkByRuntime.set(rid, `frn:entity:${topEntityCandidate}`);
					}
					if (typeof po.class === "string" && po.class.trim()) {
						classByRuntime.set(rid, po.class);
					}
					let topLevelName: string | undefined;
					if (typeof po.name === "string" && po.name.trim()) {
						topLevelName = po.name.trim();
					} else if (typeof po.displayName === "string" && po.displayName.trim()) {
						topLevelName = po.displayName.trim();
					} else if (typeof po.label === "string" && po.label.trim()) {
						topLevelName = po.label.trim();
					}
					const { displayName: fromTree, material, entityKey } =
						extractDisplayNameAndMaterialFromProps(pr);
					const displayName = topLevelName ?? fromTree;
					if (displayName) displayNameByRuntime.set(rid, displayName);
					if (material) materialByRuntime.set(rid, material);
					if (
						entityKey &&
						!/^\d+$/.test(entityKey) &&
						entityKey.length >= 10
					) {
						linkByRuntime.set(rid, `frn:entity:${entityKey}`);
					}
				}
			} catch {
				/* next batch */
			}
		}

		return parts.map((p) => {
			const rid = Number(p.id);
			if (Number.isNaN(rid)) return p;
			const cls = classByRuntime.get(rid);
			const dn = displayNameByRuntime.get(rid);
			const mat = materialByRuntime.get(rid);
			const lnk = linkByRuntime.get(rid);
			const baseName = p.name?.trim() ?? "";
			const isPlaceholder =
				baseName.length === 0 || /^object\s+\d+$/i.test(baseName);
			const name =
				dn ??
				(!isPlaceholder ? baseName : cls) ??
				`Object ${p.id}`;
			let material = p.material;
			if (mat) material = mat;
			if (cls) {
				return {
					...p,
					name,
					type: cls.toUpperCase(),
					material,
					link: lnk ?? p.link,
				};
			}
			return { ...p, name, material, link: lnk ?? p.link };
		});
	}

	/** Uses ViewerAPI.getObjects — all model objects when selector is omitted. */
	async function tryFetchViaGetObjects(
		primary: ViewerModelLike,
	): Promise<IfcAssemblyItem[] | null> {
		const viewer = api.viewer;
		if (!viewer?.getObjects) return null;

		const mids = viewerModelIdCandidates(primary);
		let rows: unknown;
		try {
			rows = await viewer.getObjects();
		} catch {
			return null;
		}
		if (!Array.isArray(rows)) return null;

		const collected: ParsedViewerObject[] = [];
		for (const mo of rows) {
			if (!mo || typeof mo !== "object") continue;
			const m = mo as Record<string, unknown>;
			const mid = typeof m.modelId === "string" ? m.modelId : "";
			if (!mid || !mids.includes(mid)) continue;
			collected.push(...collectObjectsFromModelObjectsEntry(m));
		}

		if (collected.length === 0) return null;

		const byRuntime = new Map<number, ParsedViewerObject>();
		for (const r of collected) {
			if (!byRuntime.has(r.runtimeId)) byRuntime.set(r.runtimeId, r);
		}
		const unique = [...byRuntime.values()];
		const chosen = unique.slice(0, MAX_VIEWER_OBJECTS_FALLBACK);

		let parts: IfcAssemblyItem[] = chosen.map((r) => ({
			id: String(r.runtimeId),
			name: r.name?.trim() || `Object ${r.runtimeId}`,
			type: (r.classHint ?? "UNKNOWN").toUpperCase(),
			material: "Unknown",
			link:
				r.link ??
				(r.entityKey ? `frn:entity:${r.entityKey}` : undefined),
		}));

		const modelIdForProps = mids[0] ?? primary.id;
		parts = await enrichPartsFromObjectProperties(modelIdForProps, parts);

		return parts.length > 0 ? parts : null;
	}

	/**
	 * Load assembly list via Viewer API (postMessage to Connect host). Avoids browser CORS on
	 * `fetch(https://app*.connect.trimble.com/tc/api/...)` from a third-party extension origin.
	 */
	async function tryFetchAssembliesViaViewerHierarchy(): Promise<
		IfcAssemblyItem[] | null
	> {
		const viewer = api.viewer;
		if (!viewer?.getModels) return null;
		let models: ViewerModelLike[];
		try {
			models = (await viewer.getModels()) as ViewerModelLike[];
		} catch {
			return null;
		}
		if (!models?.length) return null;

		let primary: ViewerModelLike | undefined;
		try {
			const resolved = await resolveViewerModelsForWbs(api);
			if (resolved.length > 0) {
				const r = resolved[0];
				primary =
					models.find(
						(m) =>
							m.id === r.id ||
							m.versionId === r.id ||
							m.id === r.versionId ||
							(m.versionId != null &&
								r.versionId != null &&
								m.versionId === r.versionId),
					) ??
					{
						id: r.id,
						versionId: r.versionId,
						name: r.name,
					};
			}
		} catch {
			primary = undefined;
		}
		if (!primary?.id) {
			const matched = collectMatchingViewerModels(models);
			primary = matched[0];
		}
		if (!primary?.id) return null;

		const modelIdForProps =
			viewerModelIdCandidates(primary)[0] ?? primary.id;

		const fromHierarchy = await tryFetchViaHierarchyChildren(primary);
		if (fromHierarchy?.length) {
			return enrichPartsFromObjectProperties(
				modelIdForProps,
				fromHierarchy,
			);
		}

		// Fallback only when hierarchy cannot provide entities (often returns runtime ids only).
		const fromObjects = await tryFetchViaGetObjects(primary);
		if (fromObjects?.length) return fromObjects;

		return null;
	}

	async function collectViewerTreeIds(): Promise<string[]> {
		if (!api.viewer?.getModels) return [];
		try {
			const resolved = await resolveViewerModelsForWbs(api);
			if (resolved.length > 0) {
				const out: string[] = [];
				for (const r of resolved) {
					if (r.id) out.push(r.id);
					if (r.versionId) out.push(r.versionId);
				}
				return [...new Set(out)];
			}
			const models = (await api.viewer.getModels()) as ViewerModelLike[];
			if (!models?.length) return [];
			const matched = collectMatchingViewerModels(models);
			const out: string[] = [];
			for (const m of matched) {
				if (m.id) out.push(m.id);
				if (m.versionId) out.push(m.versionId);
			}
			return [...new Set(out)];
		} catch {
			return [];
		}
	}

	if (!preferStableEntityIds) {
		const viaViewerHierarchy = await tryFetchAssembliesViaViewerHierarchy();
		if (viaViewerHierarchy) {
			// Keep viewer data when it already contains stable links.
			// If it has zero links, continue to REST/model-tree path to recover GUID-based links.
			if (countStableLinks(viaViewerHierarchy) > 0) {
				return viaViewerHierarchy;
			}
		}
	}

	let idCandidates = uniqStrings([
		...(await collectViewerTreeIds()),
		ifcVersionId,
		ifcFileId,
	]);

	async function tryTreeForIds(ids: string[]): Promise<unknown | null> {
		for (const id of ids) {
			const t = await getModelTreeById(id);
			if (t) return t;
		}
		return null;
	}

	function shouldPollForModelTree(stateRaw: string): boolean {
		const s = stateRaw.toUpperCase().replace(/\s+/g, "");
		if (!s || s === "UNKNOWN") return false;
		if (s.includes("FAIL") || s.includes("ERROR")) return false;
		if (
			s.includes("READY") ||
			s.includes("COMPLETE") ||
			s.includes("SUCCESS") ||
			s.includes("PROCESSED") ||
			s === "OK" ||
			s.includes("AVAILABLE") ||
			s === "ACTIVE"
		) {
			return false;
		}
		if (s.includes("PROCESS")) return true;
		if (s === "QUEUED" || s === "PENDING" || s.includes("CONVERT")) return true;
		return false;
	}

	function sleep(ms: number): Promise<void> {
		return new Promise((resolve) => window.setTimeout(resolve, ms));
	}

	async function fetchFileInfoOnce(): Promise<Record<string, unknown> | null> {
		for (const idCandidate of idCandidates) {
			const info = await getFileInfoById(idCandidate);
			if (info && typeof info === "object") {
				return info as Record<string, unknown>;
			}
		}
		return null;
	}

	let tree: unknown | null = await tryTreeForIds(idCandidates);

	if (!tree) {
		const fileObj = await fetchFileInfoOnce();
		const extras = extractModelIdsFromFileRecord(fileObj);
		const newIds = extras.filter((x) => !idCandidates.includes(x));
		if (newIds.length > 0) {
			idCandidates = [...idCandidates, ...newIds];
			tree = await tryTreeForIds(newIds);
		}
	}

	if (!tree) {
		let fileObj = await fetchFileInfoOnce();
		let processingState = getFileProcessingStateShallow(fileObj);

		if (shouldPollForModelTree(processingState)) {
			const maxWaitMs = 90_000;
			const intervalMs = 5000;
			const deadline = Date.now() + maxWaitMs;
			while (Date.now() < deadline) {
				await sleep(intervalMs);
				const viewerIds = await collectViewerTreeIds();
				const merged = uniqStrings([...viewerIds, ...idCandidates]);
				tree = await tryTreeForIds(merged);
				if (tree) break;
				fileObj = await fetchFileInfoOnce();
				processingState = getFileProcessingStateShallow(fileObj);
				if (!shouldPollForModelTree(processingState)) {
					break;
				}
			}
		}

		if (!tree) {
			// In strict stable-id mode, REST tree reads can fail in browser due to CORS.
			// Fall back to viewer hierarchy instead of hard-failing reload.
			const viaViewerHierarchyFallback = await tryFetchAssembliesViaViewerHierarchy();
			if (viaViewerHierarchyFallback?.length) {
				return viaViewerHierarchyFallback;
			}
			const finalState = getFileProcessingStateShallow(fileObj);
			const originHint =
				"Set VITE_TRIMBLE_CONNECT_ORIGIN to the same origin as your Connect tab (NA: https://app.connect.trimble.com, EU: https://app21.connect.trimble.com, Asia: https://app31.connect.trimble.com), rebuild, and redeploy. Wrong region or cross-origin blocks look like this. In Folders mode, open the IFC in the 3D viewer once so the viewer model id is available, then Retry.";
			if (shouldPollForModelTree(finalState)) {
				throw new Error(
					`Model tree still unavailable after waiting (~90s). Data API processing state (file/version only): ${finalState}. Open the IFC in the Trimble 3D viewer so the extension can use the viewer model id, then Retry. ${originHint}`,
				);
			}
			throw new Error(
				`Model tree unavailable for selected IFC (REST returned no usable tree; browser may block cross-origin requests from the extension host). Data API processing state: ${finalState}. Open the IFC in the 3D viewer and Retry — assemblies can load via the Viewer API without CORS. ${originHint}`,
			);
		}
	}

	const result: IfcAssemblyItem[] = [];
	const seen = new Set<string>();
	if (listAllIfcObjects) {
		if (Array.isArray(tree)) {
			for (const root of tree) {
				collectAllObjectNodesFromTree(root, result, seen);
			}
		} else {
			collectAllObjectNodesFromTree(tree, result, seen);
		}
	}
	if (result.length === 0) {
		seen.clear();
		if (Array.isArray(tree)) {
			for (const root of tree) {
				collectIfcAssembliesFromTree(root, result, seen);
			}
		} else {
			collectIfcAssembliesFromTree(tree, result, seen);
		}
	}

	if (result.length === 0) {
		const diagnostics = analyzeTree(tree);
		const classHint = diagnostics.classSamples.length
			? diagnostics.classSamples.join(", ")
			: "none";
		const debugAllNodes: IfcAssemblyItem[] = [];
		const debugSeen = new Set<string>();
		collectAllObjectNodesFromTree(tree, debugAllNodes, debugSeen);
		if (debugAllNodes.length > 0) {
			return debugAllNodes;
		}
		throw new Error(
			`No IFC object nodes found in the model tree. Nodes inspected: ${diagnostics.nodeCount}. Top classes/types: ${classHint}.`,
		);
	}

	return result.map((row) => {
		if (row.link?.trim()) return row;
		const stable = (row.id ?? "").trim();
		if (!stable || /^\d+$/.test(stable) || stable.length < 4) return row;
		return { ...row, link: `frn:entity:${stable}` };
	});
}

export async function fetchProcessAssemblies(
	api: WorkspaceApi,
	processFolderId: string,
): Promise<AssemblyItem[]> {
	const project = await api.project.getProject();
	if (!project?.id) {
		throw new Error("No project selected.");
	}

	const token = await api.extension.requestPermission("accesstoken");
	if (token === "denied" || token === "pending") {
		throw new Error(
			`Access token ${token}. Please grant permission in extension settings.`,
		);
	}

	const client = new TrimbleClient({
		accessToken: token,
		region: "eu",
		useDevProxy: import.meta.env.DEV,
	});

	// process folder -> ifc or ifcfile subfolder
	const processItems = await client.listFolderItems(
		processFolderId,
		project.id,
	);
	if (!processItems) return [];

	const IFC_FOLDER_NAMES = ["ifc", "ifcfile"];
	const ifcFolder = processItems.find(
		(item) =>
			item.type?.toUpperCase() === "FOLDER" &&
			IFC_FOLDER_NAMES.includes(item.name?.toLowerCase() ?? ""),
	);
	if (!ifcFolder) return [];

	const ifcFolderId = ifcFolder.id || ifcFolder.versionId || "";
	const ifcItems = await client.listFolderItems(ifcFolderId, project.id);
	if (!ifcItems) return [];

	// ifc folder -> assemblies subfolder
	const assembliesFolder = ifcItems.find(
		(item) =>
			item.type?.toUpperCase() === "FOLDER" &&
			item.name?.toLowerCase() === "assemblies",
	);
	if (!assembliesFolder) return [];

	const assembliesFolderId =
		assembliesFolder.id || assembliesFolder.versionId || "";
	const assemblyItems = await client.listFolderItems(
		assembliesFolderId,
		project.id,
	);
	if (!assemblyItems) return [];

	// Filter to .ifc files: exclude folders, include by .ifc extension
	// Trimble API may use type "FILE", "MODEL", or omit type for files
	let ifcFiles = assemblyItems.filter((item) => {
		const isFolder = item.type?.toUpperCase() === "FOLDER";
		const hasIfcExt = isIfcFile(item.name ?? "");
		return !isFolder && hasIfcExt;
	});

	// Fallback: if strict filter yields nothing, include any item with .ifc in name
	if (ifcFiles.length === 0 && assemblyItems.length > 0) {
		ifcFiles = assemblyItems.filter((item) => isIfcFile(item.name ?? ""));
	}

	return ifcFiles.map((f) => ({
		id: f.id || "",
		versionId: f.versionId,
		name: f.name ?? "Unknown",
	}));
}
