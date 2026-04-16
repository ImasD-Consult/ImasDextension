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
        <p class="text-xs text-gray-500">Generate a QR from current 3D selection to open in Trimble Connect.</p>
      </div>
      <p class="text-xs text-gray-600" data-qr-status>Click Generate to create a QR for the active model.</p>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="rounded px-3 py-1.5 text-sm font-medium bg-brand-600 text-white hover:bg-brand-700"
          data-generate-qr
        >
          Generate model QR
        </button>
      </div>
      <div class="rounded border border-gray-200 bg-white p-3 flex flex-col gap-3">
        <div class="flex items-center justify-between gap-3">
          <a
            href="#"
            class="text-xs text-brand-700 hover:underline hidden"
            data-qr-link
            target="_blank"
            rel="noopener noreferrer"
          >
            Open generated link
          </a>
          <p class="text-[11px] text-gray-500">Scan with Trimble Connect mobile QR scanner.</p>
        </div>
        <div class="flex items-center justify-center">
          <img class="hidden h-40 w-40 rounded border border-gray-200" data-qr-image alt="Generated QR" />
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
	if (!status || !generateButton || !qrImage || !qrLink) return;

	generateButton.addEventListener("click", async () => {
		try {
			status.textContent = "Reading active model...";

			const viewerModels = await resolveViewerModelsForWbs(api);
			const active = viewerModels[0];
			const resolvedModelId = active?.id ?? active?.versionId;
			if (!resolvedModelId) {
				status.textContent =
					"No active model found in the 3D viewer.";
				return;
			}
			const project = await api.project.getProject();
			const projectId = project?.id;
			if (!projectId) {
				status.textContent = "Could not resolve Trimble project id.";
				return;
			}

			const payload: QrTargetPayload = {
				v: 1,
				projectId,
				modelId: resolvedModelId,
				modelVersionId: active?.versionId,
				partId: "",
				partName: active?.name ?? "Model",
				partType: "IFCModel",
				createdAt: new Date().toISOString(),
			};
			const deepLink = buildQrNavigationUrl(payload);
			if (!deepLink) {
				status.textContent =
					"QR target URL could not be built. Set TRIMBLE_CONNECT_QR_URL_TEMPLATE to a working Trimble file/view link pattern.";
				return;
			}
			const dataUrl = await toQrDataUrl(deepLink);

			qrImage.classList.remove("hidden");
			qrImage.src = dataUrl;
			qrLink.classList.remove("hidden");
			qrLink.href = deepLink;
			status.textContent =
				"QR generated for model. Scan it with your phone QR reader and open in Trimble Connect.";
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to generate QR.";
			status.textContent = message;
		}
	});
}
