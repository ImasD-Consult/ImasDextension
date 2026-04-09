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
		};
		ui: {
			setMenu(config: MenuConfig): Promise<void>;
			setActiveMenuItem(command: string): Promise<void>;
		};
		viewer?: {
			getModels(): Promise<ViewerModel[]>;
			/** Assembly / spatial hierarchy without cross-origin fetch (postMessage to Connect). */
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
