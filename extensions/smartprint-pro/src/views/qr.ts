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
      <div class="rounded border border-gray-200 bg-white p-3 flex flex-col gap-2">
        <div class="flex items-center justify-center gap-3">
          <a
            href="#"
            class="text-xs text-brand-700 hover:underline hidden"
            data-qr-link
            target="_blank"
            rel="noopener noreferrer"
          >
            Open generated link
          </a>
        </div>
        <div class="flex items-center justify-center">
          <img class="hidden h-40 w-40 rounded border border-gray-200" data-qr-image alt="Generated QR" />
        </div>
        <p class="mt-1 text-[11px] text-gray-500 text-center">
          Scan the QR with the Trimble Connect mobile QR scanner.
        </p>
      </div>

      <div class="mt-4 border-t border-gray-200 pt-3 space-y-3">
        <h3 class="text-sm font-semibold text-gray-800">Batch Assembly Drawing QRs</h3>
        <p class="text-xs text-gray-600">
          Select folders for assembly PDFs and IFC models. Then choose where the QR should appear on the drawing.
        </p>

        <div class="flex flex-col gap-2">
          <button
            type="button"
            class="inline-flex items-center justify-center rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            data-select-pdf-folder
          >
            Select PDF folder…
          </button>
          <p class="text-[11px] text-gray-500 truncate" data-selected-pdf-folder>
            No PDF folder selected.
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <button
            type="button"
            class="inline-flex items-center justify-center rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            data-select-ifc-folder
          >
            Select IFC folder…
          </button>
          <p class="text-[11px] text-gray-500 truncate" data-selected-ifc-folder>
            No IFC folder selected.
          </p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <p class="mb-1 text-xs font-medium text-gray-700">QR position</p>
            <div class="grid grid-cols-2 gap-1 text-[11px] text-gray-700">
              <label class="inline-flex items-center gap-1">
                <input type="radio" name="qr-position" value="top-left" class="h-3 w-3" checked />
                <span>Top left</span>
              </label>
              <label class="inline-flex items-center gap-1">
                <input type="radio" name="qr-position" value="top-right" class="h-3 w-3" />
                <span>Top right</span>
              </label>
              <label class="inline-flex items-center gap-1">
                <input type="radio" name="qr-position" value="bottom-left" class="h-3 w-3" />
                <span>Bottom left</span>
              </label>
              <label class="inline-flex items-center gap-1">
                <input type="radio" name="qr-position" value="bottom-right" class="h-3 w-3" />
                <span>Bottom right</span>
              </label>
            </div>
          </div>
          <div>
            <p class="mb-1 text-xs font-medium text-gray-700">QR size</p>
            <select
              class="w-full rounded border border-gray-300 px-2 py-1 text-xs text-gray-800"
              data-qr-size
            >
              <option value="small">Small</option>
              <option value="medium" selected>Medium</option>
              <option value="large">Large</option>
            </select>
          </div>
        </div>

        <button
          type="button"
          class="w-full rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          data-generate-batch
          disabled
        >
          Generate QRs on assembly PDFs
        </button>
        <p class="text-[11px] text-gray-500" data-batch-status>
          Select both folders to enable batch generation.
        </p>
      </div>
    </div>
  `;

	const status = container.querySelector<HTMLElement>("[data-qr-status]");
	const generateButton = container.querySelector<HTMLButtonElement>(
		"[data-generate-qr]",
	);
	const qrImage = container.querySelector<HTMLImageElement>("[data-qr-image]");
	const qrLink = container.querySelector<HTMLAnchorElement>("[data-qr-link]");
	const pdfFolderButton = container.querySelector<HTMLButtonElement>(
		"[data-select-pdf-folder]",
	);
	const ifcFolderButton = container.querySelector<HTMLButtonElement>(
		"[data-select-ifc-folder]",
	);
	const pdfFolderLabel = container.querySelector<HTMLElement>(
		"[data-selected-pdf-folder]",
	);
	const ifcFolderLabel = container.querySelector<HTMLElement>(
		"[data-selected-ifc-folder]",
	);
	const batchButton = container.querySelector<HTMLButtonElement>(
		"[data-generate-batch]",
	);
	const batchStatus = container.querySelector<HTMLElement>("[data-batch-status]");
	if (
		!status ||
		!generateButton ||
		!qrImage ||
		!qrLink ||
		!pdfFolderButton ||
		!ifcFolderButton ||
		!pdfFolderLabel ||
		!ifcFolderLabel ||
		!batchButton ||
		!batchStatus
	) {
		return;
	}

	let selectedPdfFolder = "";
	let selectedIfcFolder = "";

	const refreshBatchUi = (): void => {
		const ready = selectedPdfFolder.trim().length > 0 &&
			selectedIfcFolder.trim().length > 0;
		batchButton.disabled = !ready;
		batchStatus.textContent = ready
			? "Ready to generate QRs for matching PDF/IFC pairs."
			: "Select both folders to enable batch generation.";
	};

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

	pdfFolderButton.addEventListener("click", () => {
		// Placeholder: real implementation will open a folder picker / backend config.
		selectedPdfFolder = "/project/folders/assemblies";
		pdfFolderLabel.textContent = "PDF folder: /project/folders/assemblies";
		refreshBatchUi();
	});

	ifcFolderButton.addEventListener("click", () => {
		// Placeholder: real implementation will open a folder picker / backend config.
		selectedIfcFolder = "/project/folders/ifc";
		ifcFolderLabel.textContent = "IFC folder: /project/folders/ifc";
		refreshBatchUi();
	});

	batchButton.addEventListener("click", () => {
		if (batchButton.disabled) return;
		batchStatus.textContent =
			"Batch generation is not implemented yet. This will match PDFs and IFCs by name and stamp QRs on the PDFs.";
	});

	refreshBatchUi();
}
