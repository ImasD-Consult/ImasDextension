import { TrimbleClient, TRIMBLE_REGIONS } from "@imasd/shared/trimble";
import type { WorkspaceApi } from "@imasd/shared/trimble";

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

/**
 * When the extension runs on a custom host (e.g. extensions.imasd.dev), relative `/tc/api/...`
 * requests do not reach Trimble Connect. Prefer VITE_TRIMBLE_CONNECT_ORIGIN, then the Connect
 * iframe parent from ancestorOrigins, then known regional hosts.
 */
function getConnectTrimbleBaseUrls(): string[] {
	const bases = new Set<string>();
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
	const candidates = [node.children, node.items, node.nodes, node.entities];
	for (const candidate of candidates) {
		if (Array.isArray(candidate)) return candidate;
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
				link: readNodeString(node, ["frn", "link"]),
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

	if (id && !seen.has(id)) {
		seen.add(id);
		acc.push({
			id,
			name: name ?? `${classOrType} ${id}`,
			type: classOrType.toUpperCase(),
			material: "Unknown",
			link: readNodeString(node, ["frn", "link"]),
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

/** Reject empty 200 bodies (e.g. `{}`) that are not a real model tree. */
function isUsableTreeResponse(data: unknown): boolean {
	if (data == null) return false;
	if (Array.isArray(data)) return data.length > 0;
	if (typeof data !== "object") return false;
	const o = data as Record<string, unknown>;
	if (Object.keys(o).length === 0) return false;
	const wc = treeWalkCount(data);
	if (wc > 1) return true;
	if (wc === 1) {
		const hasId =
			readNodeString(o, ["guid", "id", "runtimeId", "entityId"])?.length ?? 0;
		return hasId > 0;
	}
	return false;
}

function deepFindString(obj: unknown, keys: string[]): string | undefined {
	if (!obj || typeof obj !== "object") return undefined;
	const o = obj as Record<string, unknown>;
	for (const k of keys) {
		const v = o[k];
		if (typeof v === "string" && v.trim().length > 0) return v;
	}
	for (const v of Object.values(o)) {
		if (v && typeof v === "object") {
			const found = deepFindString(v, keys);
			if (found) return found;
		}
	}
	return undefined;
}

export async function fetchIfcAssembliesFromFile(
	api: WorkspaceApi,
	ifcFileId: string,
	ifcVersionId?: string,
): Promise<IfcAssemblyItem[]> {
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
				return item;
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

	const idCandidates = [ifcVersionId, ifcFileId].filter(
		(value): value is string => typeof value === "string" && value.length > 0,
	);

	function getFileProcessingState(fileObj: Record<string, unknown> | null): string {
		if (!fileObj) return "unknown";
		const specific = deepFindString(fileObj, [
			"processingState",
			"processingStatus",
			"conversionStatus",
			"modelProcessingState",
		]);
		if (specific) return specific;
		const generic = deepFindString(fileObj, ["status"]);
		return generic ?? "unknown";
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
	let tree: unknown | null = null;
	for (const idCandidate of idCandidates) {
		tree = await getModelTreeById(idCandidate);
		if (tree) break;
	}

	if (!tree) {
		let fileObj = await fetchFileInfoOnce();
		let processingState = getFileProcessingState(fileObj);

		if (shouldPollForModelTree(processingState)) {
			const maxWaitMs = 180_000;
			const intervalMs = 4000;
			const deadline = Date.now() + maxWaitMs;
			while (Date.now() < deadline) {
				await sleep(intervalMs);
				for (const idCandidate of idCandidates) {
					tree = await getModelTreeById(idCandidate);
					if (tree) break;
				}
				if (tree) break;
				fileObj = await fetchFileInfoOnce();
				processingState = getFileProcessingState(fileObj);
				if (!shouldPollForModelTree(processingState)) {
					break;
				}
			}
		}

		if (!tree) {
			const finalState = getFileProcessingState(fileObj);
			const originHint =
				"If the model opens in 3D but this fails, set VITE_TRIMBLE_CONNECT_ORIGIN to your Trimble Connect origin (e.g. https://app21.connect.trimble.com) and rebuild the extension.";
			if (shouldPollForModelTree(finalState)) {
				throw new Error(
					`Model tree still unavailable after waiting (~3 min). File processing state: ${finalState}. Open the file in Trimble Connect Data view and confirm processing finished, then Retry. ${originHint}`,
				);
			}
			throw new Error(
				`Model tree unavailable for selected IFC (no usable tree from API). File processing state: ${finalState}. ${originHint}`,
			);
		}
	}

	const result: IfcAssemblyItem[] = [];
	const seen = new Set<string>();
	if (Array.isArray(tree)) {
		for (const root of tree) {
			collectIfcAssembliesFromTree(root, result, seen);
		}
	} else {
		collectIfcAssembliesFromTree(tree, result, seen);
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
			`No assembly nodes found and no object nodes extracted. Nodes inspected: ${diagnostics.nodeCount}. Top classes/types: ${classHint}.`,
		);
	}

	return result;
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
