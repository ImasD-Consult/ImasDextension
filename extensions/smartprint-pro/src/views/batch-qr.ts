import type { WorkspaceApi } from "@imasd/shared/trimble";
import { fetchSmartprintFolderProSubfolders } from "../services/folders";

type BatchState = {
	pdfFolderId: string;
	pdfFolderName: string;
	ifcFolderId: string;
	ifcFolderName: string;
	position: "top-left" | "top-right" | "bottom-left" | "bottom-right";
	size: "small" | "medium" | "large";
};

export async function renderBatchQrPanel(
	container: HTMLElement,
	api: WorkspaceApi,
): Promise<void> {
	container.innerHTML = `
    <div class="h-full min-h-0 w-full flex flex-col gap-3 text-gray-900">
      <div class="border-b border-gray-200 pb-2">
        <h2 class="text-base font-semibold">Batch Assembly Drawing QRs</h2>
        <p class="text-xs text-gray-500">
          Match assembly PDFs and IFC models by name and place a Trimble Connect QR in each drawing.
        </p>
      </div>

      <p class="text-xs text-gray-600" data-batch-status>
        Loading project folders...
      </p>

      <div class="space-y-3" data-batch-content hidden>
        <div class="flex flex-col gap-2">
          <p class="text-xs font-medium text-gray-700">PDF folder</p>
          <select
            class="w-full rounded border border-gray-300 px-2 py-1 text-xs text-gray-800"
            data-pdf-folder-select
          >
          </select>
          <p class="text-[11px] text-gray-500 truncate" data-selected-pdf-folder>
            No PDF folder selected.
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <p class="text-xs font-medium text-gray-700">IFC folder</p>
          <select
            class="w-full rounded border border-gray-300 px-2 py-1 text-xs text-gray-800"
            data-ifc-folder-select
          >
          </select>
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
      </div>
    </div>
  `;

	const status = container.querySelector<HTMLElement>("[data-batch-status]");
	const content = container.querySelector<HTMLElement>("[data-batch-content]");
	const pdfSelect =
		container.querySelector<HTMLSelectElement>("[data-pdf-folder-select]");
	const ifcSelect =
		container.querySelector<HTMLSelectElement>("[data-ifc-folder-select]");
	const pdfLabel = container.querySelector<HTMLElement>(
		"[data-selected-pdf-folder]",
	);
	const ifcLabel = container.querySelector<HTMLElement>(
		"[data-selected-ifc-folder]",
	);
	const sizeSelect = container.querySelector<HTMLSelectElement>("[data-qr-size]");
	const batchButton = container.querySelector<HTMLButtonElement>(
		"[data-generate-batch]",
	);

	if (
		!status ||
		!content ||
		!pdfSelect ||
		!ifcSelect ||
		!pdfLabel ||
		!ifcLabel ||
		!sizeSelect ||
		!batchButton
	) {
		return;
	}

	const state: BatchState = {
		pdfFolderId: "",
		pdfFolderName: "",
		ifcFolderId: "",
		ifcFolderName: "",
		position: "top-left",
		size: "medium",
	};

	const refreshUi = (): void => {
		const ready = state.pdfFolderId && state.ifcFolderId;
		batchButton.disabled = !ready;
		if (!ready) {
			status.textContent =
				"Select both PDF and IFC folders to enable batch generation.";
		} else {
			status.textContent =
				"Ready. Generate will match PDFs and IFCs by name and send jobs to the QR stamping service.";
		}
	};

	try {
		const folders = await fetchSmartprintFolderProSubfolders(api);
		if (!folders.items.length) {
			status.textContent =
				"No folders found. Create a smartprintPRO folder in the project first.";
			return;
		}
		const options = folders.items
			.map(
				(item) =>
					`<option value="${item.id}">${item.name}</option>`,
			)
			.join("");
		pdfSelect.innerHTML = `<option value="">Select PDF folder…</option>${options}`;
		ifcSelect.innerHTML = `<option value="">Select IFC folder…</option>${options}`;
		content.hidden = false;
		status.textContent =
			"Select the folders that contain your assembly PDFs and IFC models.";
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Failed to load project folders.";
		status.textContent = message;
		return;
	}

	pdfSelect.addEventListener("change", () => {
		const id = pdfSelect.value;
		const name =
			pdfSelect.options[pdfSelect.selectedIndex]?.textContent ?? "Folder";
		state.pdfFolderId = id;
		state.pdfFolderName = name;
		pdfLabel.textContent = id
			? `PDF folder: ${name}`
			: "No PDF folder selected.";
		refreshUi();
	});

	ifcSelect.addEventListener("change", () => {
		const id = ifcSelect.value;
		const name =
			ifcSelect.options[ifcSelect.selectedIndex]?.textContent ?? "Folder";
		state.ifcFolderId = id;
		state.ifcFolderName = name;
		ifcLabel.textContent = id
			? `IFC folder: ${name}`
			: "No IFC folder selected.";
		refreshUi();
	});

	container.addEventListener("change", (event) => {
		const target = event.target as HTMLInputElement | HTMLSelectElement;
		if (target.name === "qr-position") {
			const val = target.value as BatchState["position"];
			state.position = val;
		}
		if (target === sizeSelect) {
			const val = sizeSelect.value as BatchState["size"];
			state.size = val;
		}
	});

	batchButton.addEventListener("click", () => {
		if (batchButton.disabled) return;
		status.textContent =
			`Would generate QRs for PDFs in "${state.pdfFolderName}" using IFCs in "${state.ifcFolderName}" (${state.position}, ${state.size}). Backend integration pending.`;
	});

	refreshUi();
}

