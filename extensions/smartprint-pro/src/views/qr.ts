import { escapeHtml } from "@imasd/shared";
import type { WorkspaceApi } from "@imasd/shared/trimble";
import {
	buildQrNavigationUrl,
	toQrDataUrl,
	type QrTargetPayload,
} from "../services/qr";
import { resolveViewerModelsForWbs } from "../services/viewer-model";

type ViewerSelectionRow = {
	modelId?: string;
	objectRuntimeIds?: number[];
};

async function readViewerSelection(
	api: WorkspaceApi,
): Promise<{ modelId?: string; runtimeId?: number; source: string }> {
	const viewer = api.viewer as WorkspaceApi["viewer"] & {
		getSelection?: () => Promise<{ modelObjectIds?: ViewerSelectionRow[] }>;
		getObjects?: (
			selector?: { selected?: boolean },
			objectState?: Record<string, unknown>,
		) => Promise<Array<{ modelId?: string; objects?: unknown }>>;
	};

	// Primary path
	try {
		const selected = await viewer?.getSelection?.();
		for (const row of selected?.modelObjectIds ?? []) {
			for (const rid of row.objectRuntimeIds ?? []) {
				if (typeof rid === "number" && !Number.isNaN(rid)) {
					return { modelId: row.modelId, runtimeId: rid, source: "getSelection" };
				}
			}
		}
	} catch {
		/* fallback below */
	}

	// Compatibility fallback: selected object selector
	try {
		const rows = await viewer?.getObjects?.({ selected: true });
		for (const row of rows ?? []) {
			const objects = row.objects;
			if (!Array.isArray(objects)) continue;
			for (const obj of objects) {
				if (typeof obj === "number" && !Number.isNaN(obj)) {
					return { modelId: row.modelId, runtimeId: obj, source: "getObjects:selected" };
				}
				if (!obj || typeof obj !== "object") continue;
				const o = obj as Record<string, unknown>;
				const rid =
					typeof o.objectRuntimeId === "number"
						? o.objectRuntimeId
						: typeof o.id === "number"
							? o.id
							: typeof o.runtimeId === "number"
								? o.runtimeId
								: null;
				if (typeof rid === "number" && !Number.isNaN(rid)) {
					return { modelId: row.modelId, runtimeId: rid, source: "getObjects:selected" };
				}
			}
		}
	} catch {
		/* fallback below */
	}

	// Additional fallback used by some hosts: entityState.Selected = 1
	try {
		const rows = await viewer?.getObjects?.(undefined, { entityState: 1 });
		for (const row of rows ?? []) {
			const objects = row.objects;
			if (!Array.isArray(objects)) continue;
			for (const obj of objects) {
				if (typeof obj === "number" && !Number.isNaN(obj)) {
					return {
						modelId: row.modelId,
						runtimeId: obj,
						source: "getObjects:entityState",
					};
				}
				if (!obj || typeof obj !== "object") continue;
				const o = obj as Record<string, unknown>;
				const rid =
					typeof o.objectRuntimeId === "number"
						? o.objectRuntimeId
						: typeof o.id === "number"
							? o.id
							: typeof o.runtimeId === "number"
								? o.runtimeId
								: null;
				if (typeof rid === "number" && !Number.isNaN(rid)) {
					return {
						modelId: row.modelId,
						runtimeId: rid,
						source: "getObjects:entityState",
					};
				}
			}
		}
	} catch {
		/* no further fallback */
	}

	return { source: "none" };
}

export async function renderQrPanel(
	container: HTMLElement,
	api: WorkspaceApi,
): Promise<void> {
	container.innerHTML = `
    <div class="h-full min-h-0 w-full flex flex-col gap-3 text-gray-900">
      <div class="border-b border-gray-200 pb-2">
        <h2 class="text-base font-semibold">QR Targets</h2>
        <p class="text-xs text-gray-500">Generate a QR from current 3D selection to open in Trimble Connect.</p>
      </div>
      <p class="text-xs text-gray-600" data-qr-status>Select one object in the viewer, then click Generate.</p>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="rounded px-3 py-1.5 text-sm font-medium bg-brand-600 text-white hover:bg-brand-700"
          data-generate-qr
        >
          Generate from current 3D selection
        </button>
      </div>
      <div class="rounded border border-gray-200 bg-white p-2 flex items-start gap-3">
        <img class="hidden h-32 w-32 rounded border border-gray-200" data-qr-image alt="Generated QR" />
        <div class="flex-1 space-y-2">
          <a
            href="#"
            class="text-xs text-brand-700 hover:underline hidden"
            data-qr-link
            target="_blank"
            rel="noopener noreferrer"
          >
            Open generated link
          </a>
          <textarea
            class="min-h-[90px] w-full rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700"
            data-qr-payload
            readonly
            placeholder="Generated payload"
          ></textarea>
        </div>
      </div>
    </div>
  `;

	const status = container.querySelector<HTMLElement>("[data-qr-status]");
	const generateButton = container.querySelector<HTMLButtonElement>(
		"[data-generate-qr]",
	);
	const qrImage = container.querySelector<HTMLImageElement>("[data-qr-image]");
	const qrLink = container.querySelector<HTMLAnchorElement>("[data-qr-link]");
	const qrPayload = container.querySelector<HTMLTextAreaElement>("[data-qr-payload]");
	if (!status || !generateButton || !qrImage || !qrLink || !qrPayload) return;

	generateButton.addEventListener("click", async () => {
		try {
			status.textContent = "Reading current 3D selection...";
			const selected = await readViewerSelection(api);
			const firstRid = selected.runtimeId;
			if (typeof firstRid !== "number") {
				status.textContent =
					`No valid selection found (source: ${selected.source}). Select one object in the 3D viewer, then click Generate again.`;
				return;
			}

			const viewerModels = await resolveViewerModelsForWbs(api);
			const active = selected.modelId
				? viewerModels.find(
						(m) => m.id === selected.modelId || m.versionId === selected.modelId,
					)
				: viewerModels[0];
			const resolvedModelId = active?.id ?? selected.modelId;
			if (!resolvedModelId) {
				status.textContent =
					"Selection read, but no active model id was resolved from viewer.";
				return;
			}

			const payload: QrTargetPayload = {
				v: 1,
				modelId: resolvedModelId,
				modelVersionId: active?.versionId,
				partId: String(firstRid),
				partName: `Object ${firstRid}`,
				partType: "IFCObject",
				partLink: `frn:tc:project:${resolvedModelId}/${firstRid}`,
				targetUrl: `frn:tc:project:${resolvedModelId}/${firstRid}`,
				createdAt: new Date().toISOString(),
			};
			const deepLink = buildQrNavigationUrl(payload);
			const dataUrl = await toQrDataUrl(deepLink);

			qrImage.classList.remove("hidden");
			qrImage.src = dataUrl;
			qrLink.classList.remove("hidden");
			qrLink.href = deepLink;
			qrPayload.value = JSON.stringify(payload, null, 2);
			status.innerHTML = `QR generated for <strong>${escapeHtml(payload.partName)}</strong> (selection source: ${escapeHtml(selected.source)}). Scan it with your phone QR reader and open in Trimble Connect.`;
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to generate QR.";
			status.textContent = message;
		}
	});
}
