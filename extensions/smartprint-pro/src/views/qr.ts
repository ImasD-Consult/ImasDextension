import { escapeHtml } from "@imasd/shared";
import type { WorkspaceApi } from "@imasd/shared/trimble";
import {
	buildQrNavigationUrl,
	toQrDataUrl,
	type QrTargetPayload,
} from "../services/qr";
import { resolveViewerModelsForWbs } from "../services/viewer-model";

export async function renderQrPanel(
	container: HTMLElement,
	api: WorkspaceApi,
): Promise<void> {
	container.innerHTML = `
    <div class="h-full min-h-0 w-full flex flex-col gap-3 text-gray-900">
      <div class="border-b border-gray-200 pb-2">
        <h2 class="text-base font-semibold">QR Targets</h2>
        <p class="text-xs text-gray-500">Generate a QR from current 3D selection for mobile scan/open.</p>
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
			const viewer = api.viewer as WorkspaceApi["viewer"] & {
				getSelection?: () => Promise<{
					modelObjectIds?: Array<{
						modelId?: string;
						objectRuntimeIds?: number[];
					}>;
				}>;
			};
			const selected = await viewer?.getSelection?.();
			const firstModel = selected?.modelObjectIds?.[0];
			const firstRid = firstModel?.objectRuntimeIds?.[0];
			if (!firstModel?.modelId || typeof firstRid !== "number") {
				status.textContent =
					"No valid selection found. Select one object in the 3D viewer.";
				return;
			}

			const viewerModels = await resolveViewerModelsForWbs(api);
			const active = viewerModels.find(
				(m) => m.id === firstModel.modelId || m.versionId === firstModel.modelId,
			);

			const payload: QrTargetPayload = {
				v: 1,
				modelId: active?.id ?? firstModel.modelId,
				modelVersionId: active?.versionId,
				partId: String(firstRid),
				partName: `Object ${firstRid}`,
				partType: "IFCObject",
				partLink: `frn:tc:project:${firstModel.modelId}/${firstRid}`,
				targetUrl: `frn:tc:project:${firstModel.modelId}/${firstRid}`,
				createdAt: new Date().toISOString(),
			};
			const deepLink = buildQrNavigationUrl(payload);
			const dataUrl = await toQrDataUrl(deepLink);

			qrImage.classList.remove("hidden");
			qrImage.src = dataUrl;
			qrLink.classList.remove("hidden");
			qrLink.href = deepLink;
			qrPayload.value = JSON.stringify(payload, null, 2);
			status.innerHTML = `QR generated for <strong>${escapeHtml(payload.partName)}</strong>.`;
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to generate QR.";
			status.textContent = message;
		}
	});
}
