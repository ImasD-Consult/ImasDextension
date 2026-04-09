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
}

function ensureTrailingSlash(uri: string): string {
	return uri.endsWith("/") ? uri : `${uri}/`;
}

function buildEntityLink(projectId: string, modelId: string, partId: string): string {
	// FRN-style link convention for external resources.
	return `frn:tc:project:${projectId}:model:${modelId}:entity:${partId}`;
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
		link: buildEntityLink(project.id, item.modelId, item.partId),
		libId,
		defId,
		props: { [propertyName]: item.value },
	}));

	const response = await pset.changeset({ items: changesetItems });
	const inline = response.data as {
		errorCount?: number;
		errors?: Array<{ message?: string }>;
	};

	if ((inline.errorCount ?? 0) > 0) {
		const firstError = inline.errors?.[0]?.message;
		throw new Error(firstError || "Property set write failed for some items.");
	}
}
