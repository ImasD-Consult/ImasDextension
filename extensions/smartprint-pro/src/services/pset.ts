import { PSet, ServiceCredentials } from "trimble-connect-sdk";
import type { WorkspaceApi } from "@imasd/shared/trimble";

const DEFAULT_PSET_SERVICE_URI = "https://pset-api.connect.trimble.com/v1/";
const DEFAULT_LIBRARY_ID = "WBS";
const DEFAULT_DEFINITION_ID = "Pset_IMASD_WBS";
const DEFAULT_PROPERTY_NAME = "Pset_IMASD_WBS";

export interface WbsPsetWriteItem {
	modelId: string;
	partId: string;
	value: string;
	link?: string;
}

function ensureTrailingSlash(uri: string): string {
	return uri.endsWith("/") ? uri : `${uri}/`;
}

function buildEntityLink(projectId: string, modelId: string, partId: string): string {
	// FRN-style link convention for external resources.
	return `frn:tc:project:${projectId}:model:${modelId}:entity:${partId}`;
}

/** Turn raw PSet API errors into something actionable in Connect Browser. */
function withPsetTroubleshootingHint(apiMessage: string): string {
	const m = apiMessage.trim();
	if (
		m.includes("library descriptor") &&
		m.includes("access control")
	) {
		return (
			`${m} ` +
			"This usually means the Property Set library cannot load its access-control policy: the library may need the newer permissions model, or your user group has no access. " +
			"In Trimble Connect for Browser (3D Viewer): open Property Set Libraries → select the library that matches your integration library id → Manage access control. " +
			"If offered, choose “Use new permissions model”, Save, then Publish the library. " +
			"Confirm a library exists with the id configured for this extension (default lib id: WBS, definition: Pset_IMASD_WBS) and that your group has Edit access to that property set."
		);
	}
	return m;
}

export async function writeWbsPropertySetValues(
	api: WorkspaceApi,
	items: WbsPsetWriteItem[],
): Promise<void> {
	if (!items.length) return;

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

	const serviceUri = ensureTrailingSlash(
		import.meta.env.VITE_PSET_SERVICE_URI || DEFAULT_PSET_SERVICE_URI,
	);
	const libId = import.meta.env.VITE_PSET_LIB_ID || DEFAULT_LIBRARY_ID;
	const defId = import.meta.env.VITE_PSET_DEF_ID || DEFAULT_DEFINITION_ID;
	const propertyName = import.meta.env.VITE_PSET_PROPERTY_NAME || DEFAULT_PROPERTY_NAME;

	const pset = new PSet({
		serviceUri,
		credentials: new ServiceCredentials(undefined, token),
	});

	const changesetItems = items.map((item) => ({
		link: item.link || buildEntityLink(project.id, item.modelId, item.partId),
		libId,
		defId,
		props: { [propertyName]: item.value },
	}));

	let response: Awaited<ReturnType<PSet["changeset"]>>;
	try {
		response = await pset.changeset({ items: changesetItems });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(withPsetTroubleshootingHint(msg));
	}

	const inline = response.data as {
		errorCount?: number;
		errors?: Array<{ message?: string }>;
	};

	if ((inline.errorCount ?? 0) > 0) {
		const firstError = inline.errors?.[0]?.message;
		throw new Error(
			withPsetTroubleshootingHint(
				firstError || "Property set write failed for some items.",
			),
		);
	}
}
