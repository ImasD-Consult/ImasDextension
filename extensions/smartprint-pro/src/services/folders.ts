import { TrimbleClient } from "@imasd/shared/trimble";
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

function collectIfcAssembliesFromTree(
	tree: unknown,
	acc: IfcAssemblyItem[],
	seen: Set<string>,
): void {
	if (!tree || typeof tree !== "object") return;
	const node = tree as Record<string, unknown>;

	const classOrType =
		readNodeString(node, ["class", "type", "entityType", "ifcClass"]) ?? "";
	if (classOrType.toLowerCase() === "ifcelementassembly") {
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

	for (const child of readNodeChildren(node)) {
		collectIfcAssembliesFromTree(child, acc, seen);
	}
}

export async function fetchIfcAssembliesFromFile(
	api: WorkspaceApi,
	ifcFileId: string,
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

	const client = new TrimbleClient({
		accessToken: token,
		region: "eu",
		useDevProxy: import.meta.env.DEV,
	});

	const tree = await client.getModelTree(ifcFileId, project.id);
	if (!tree) return [];

	const result: IfcAssemblyItem[] = [];
	const seen = new Set<string>();
	if (Array.isArray(tree)) {
		for (const root of tree) {
			collectIfcAssembliesFromTree(root, result, seen);
		}
	} else {
		collectIfcAssembliesFromTree(tree, result, seen);
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
