import type { WorkspaceApi } from "@imasd/shared/trimble";

/** BIM models we support for WBS / IFC assembly APIs (excludes DWG etc. from the file tree). */
function isIfcFileName(name: string | undefined): boolean {
	if (!name) return false;
	return /\.(ifc|ifczip|ifcxml)$/i.test(name.trim());
}

export type ViewerModelRow = {
	id: string;
	versionId?: string;
	name?: string;
	state?: string;
};

function modelIdInSet(m: ViewerModelRow, ids: Set<string>): boolean {
	const a = m.id ? String(m.id) : "";
	const b = m.versionId ? String(m.versionId) : "";
	return (a.length > 0 && ids.has(a)) || (b.length > 0 && ids.has(b));
}

/**
 * `getObjects()` returns model entities currently in the scene — each entry has `modelId`
 * (often `versionId`). That matches what is actually visible better than raw `getModels()` order.
 */
async function matchModelsFromSceneObjects(
	viewer: NonNullable<WorkspaceApi["viewer"]>,
	allModels: ViewerModelRow[],
): Promise<ViewerModelRow[]> {
	if (!viewer.getObjects) return [];
	try {
		const rows = await viewer.getObjects();
		if (!Array.isArray(rows) || rows.length === 0) return [];

		const sceneModelIds = new Set<string>();
		for (const mo of rows) {
			if (!mo || typeof mo !== "object") continue;
			const mid = (mo as { modelId?: string }).modelId;
			if (typeof mid === "string" && mid.trim().length > 0) {
				sceneModelIds.add(mid.trim());
			}
		}
		if (sceneModelIds.size === 0) return [];

		const matched = allModels.filter((m) => modelIdInSet(m, sceneModelIds));
		return matched;
	} catch {
		return [];
	}
}

/**
 * Resolution order:
 * 1. **Scene objects** (`getObjects` → modelIds with geometry) — strongest signal for “what is open”.
 * 2. **Presentation** `applyToModels` — view-scoped ids when (1) is empty.
 * 3. **Loaded** / **state** / full tree — same as before.
 *
 * `getModels()` alone is only the file tree; order can put DWG before IFC.
 */
export async function resolveViewerModelsForWbs(
	api: WorkspaceApi,
): Promise<ViewerModelRow[]> {
	const viewer = api.viewer;
	if (!viewer?.getModels) return [];

	const gv = viewer.getModels.bind(viewer) as (
		state?: "loaded" | "unloaded",
	) => Promise<ViewerModelRow[]>;

	async function fetchAll(): Promise<ViewerModelRow[]> {
		try {
			const all = (await gv()) as ViewerModelRow[];
			return Array.isArray(all) ? all : [];
		} catch {
			return [];
		}
	}

	const allModels = await fetchAll();
	if (allModels.length === 0) return [];

	const fromScene = await matchModelsFromSceneObjects(viewer, allModels);
	if (fromScene.length > 0) {
		const ifcFromScene = fromScene.filter((m) => isIfcFileName(m.name));
		return ifcFromScene.length > 0 ? ifcFromScene : fromScene;
	}

	let appliedIds: string[] | undefined;
	try {
		const pres = await viewer.getPresentation?.();
		appliedIds = pres?.applyToModels;
	} catch {
		appliedIds = undefined;
	}
	const appliedSet = new Set(
		(appliedIds ?? []).map((x) => String(x)).filter(Boolean),
	);

	let pool = allModels;

	if (appliedSet.size > 0) {
		const narrowed = pool.filter((m) => modelIdInSet(m, appliedSet));
		if (narrowed.length > 0) {
			pool = narrowed;
		}
	}

	let list: ViewerModelRow[] = [];
	try {
		const loadedOnly = (await gv("loaded")) as ViewerModelRow[];
		if (Array.isArray(loadedOnly) && loadedOnly.length > 0) {
			const poolIds = new Set(pool.map((p) => p.id));
			const intersect = loadedOnly.filter((m) => poolIds.has(m.id));
			list = intersect.length > 0 ? intersect : loadedOnly.filter((m) =>
				pool.some(
					(p) => p.id === m.id || (p.versionId && p.versionId === m.versionId),
				),
			);
			if (list.length === 0) {
				list = loadedOnly;
			}
		}
	} catch {
		/* host may not support "loaded" */
	}

	if (list.length === 0) {
		const byState = pool.filter(
			(m) => (m.state ?? "").toLowerCase() === "loaded",
		);
		list = byState.length > 0 ? byState : pool;
	}

	const ifcPreferred = list.filter((m) => isIfcFileName(m.name));
	return ifcPreferred.length > 0 ? ifcPreferred : list;
}
