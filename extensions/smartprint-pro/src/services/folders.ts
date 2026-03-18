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

const SMARTPRINT_FOLDER_PRO_NAME = "smartprintfolderpro";

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
	const smartprintFolder = rootFolders.find(
		(f) => f.name?.toLowerCase() === SMARTPRINT_FOLDER_PRO_NAME.toLowerCase(),
	);

	if (!smartprintFolder) {
		return { items: [], source: "api" };
	}

	const items = await client.listFolderItems(
		smartprintFolder.id || smartprintFolder.versionId || "",
		project.id,
	);

	if (!items) {
		return { items: [], source: "api" };
	}

	const subfolders = items.filter(
		(item) => item.type?.toUpperCase() === "FOLDER",
	);

	return {
		items: subfolders.map((f) => ({
			id: f.id || f.versionId || "",
			name: f.name,
		})),
		source: "api",
	};
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

	// process folder -> ifc subfolder
	const processItems = await client.listFolderItems(processFolderId, project.id);
	if (!processItems) return [];

	const ifcFolder = processItems.find(
		(item) =>
			item.type?.toUpperCase() === "FOLDER" &&
			item.name?.toLowerCase() === "ifc",
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

	// Filter to IFC files
	const ifcFiles = assemblyItems.filter(
		(item) =>
			item.type?.toUpperCase() !== "FOLDER" && isIfcFile(item.name ?? ""),
	);

	return ifcFiles.map((f) => ({
		id: f.id || "",
		versionId: f.versionId,
		name: f.name ?? "Unknown",
	}));
}
