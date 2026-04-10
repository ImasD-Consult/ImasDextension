declare module "trimble-connect-workspace-api" {
	export interface TrimbleProject {
		id: string;
		name?: string;
		rootId?: string;
		rootFolderId?: string;
		rootFolderIdentifier?: string;
	}

	export interface ViewerModel {
		id: string;
		versionId?: string;
		name?: string;
		/** Present on ModelSpec from getModels — use with `"loaded"` filter. */
		state?: string;
	}

	export interface MenuItem {
		title: string;
		command: string;
	}

	export interface MenuConfig {
		title: string;
		icon: string;
		command: string;
		subMenus?: MenuItem[];
	}

	export interface CommandEventData {
		data: string;
	}

	export interface WorkspaceApi {
		project: {
			getProject(): Promise<TrimbleProject>;
		};
		extension: {
			requestPermission(permission: string): Promise<string>;
			/** Host context: "project" (Data) vs "3dviewer" — see manifest `extensionType`. */
			getHost?(): Promise<{ name: "project" | "3dviewer" | string }>;
			/** 3D viewer: e.g. `{ type: "properties", height: "320px" }` for bottom strip; `{ type: "panel" }` for side panel. */
			configure?(config: Record<string, unknown>): Promise<boolean>;
		};
		ui: {
			setMenu(config: MenuConfig): Promise<void>;
			setActiveMenuItem(command: string): Promise<void>;
		};
		viewer?: {
			getModels(state?: "loaded" | "unloaded"): Promise<ViewerModel[]>;
			/** All visible model objects when selector omitted (see ObjectSelector). */
			getObjects?(
				selector?: Record<string, unknown>,
				objectState?: Record<string, unknown>,
			): Promise<Array<{ modelId: string; objects: unknown }>>;
			/** Host may return nested property sets; callers should treat entries as opaque and walk for IFC fields. */
			getObjectProperties?(
				modelId: string,
				objectRuntimeIds: number[],
			): Promise<Array<Record<string, unknown>>>;
			/** Current view: `applyToModels` aligns with models selected for the 3D view (vs raw `getModels()` file tree). */
			getPresentation?(): Promise<{ applyToModels?: string[] }>;
			/** Children of parent entity IDs — use roots like `[0]` not `[]`. */
			getHierarchyChildren?(
				modelId: string,
				entityIds: number[],
				hierarchyType?: number,
				recursive?: boolean,
			): Promise<
				Array<{ id: number; fileId: string; name: string }>
			>;
			toggleModel?(
				modelId: string | string[],
				loaded?: boolean,
				fitToView?: boolean,
			): Promise<void>;
			/** Select objects in the 3D view (runtime entity ids per model). */
			setSelection?(
				selector: {
					modelObjectIds?: Array<{
						modelId: string;
						objectRuntimeIds?: number[];
						recursive?: boolean;
					}>;
				},
				mode: "add" | "remove" | "set",
			): Promise<void>;
		};
	}

	export type EventCallback = (
		event: string,
		data: CommandEventData,
	) => void | Promise<void>;

	export function connect(
		target: Window,
		callback: EventCallback,
	): Promise<WorkspaceApi>;
}
