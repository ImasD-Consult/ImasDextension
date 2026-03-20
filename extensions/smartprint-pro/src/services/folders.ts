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

const IFC_EXTENSIONS = [".ifc", ".ifczip", ".ifcxml"];

function isIfcFile(name: string): boolean {
	const lower = name?.toLowerCase() ?? "";
	return IFC_EXTENSIONS.some((ext) => lower.endsWith(ext));
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
