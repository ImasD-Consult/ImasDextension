import {
	TrimbleClient,
	type WorkspaceApi,
} from "@imasd/shared/trimble";

type BatchState = {
	pdfFolderId: string;
	pdfFolderName: string;
	ifcFolderId: string;
	ifcFolderName: string;
	position: "top-left" | "top-right" | "bottom-left" | "bottom-right";
	size: "small" | "medium" | "large";
};

type FolderOption = {
	id: string;
	name: string;
	parentId: string;
};

type FolderModalTarget = "pdf" | "ifc";

type FolderModalState = {
	open: boolean;
	target: FolderModalTarget;
	currentFolderId: string;
	crumbs: Array<{ id: string; name: string }>;
	items: FolderOption[];
	selectedId: string;
	selectedName: string;
	loading: boolean;
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
          <button
            type="button"
            class="inline-flex items-center justify-center rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            data-open-folder-modal="pdf"
          >
            Select PDF folder...
          </button>
          <p class="text-[11px] text-gray-500 truncate" data-selected-pdf-folder>
            No PDF folder selected.
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <p class="text-xs font-medium text-gray-700">IFC folder</p>
          <button
            type="button"
            class="inline-flex items-center justify-center rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            data-open-folder-modal="ifc"
          >
            Select IFC folder...
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
      </div>

      <div class="hidden fixed inset-0 z-50 bg-black/40 p-4" data-folder-modal>
        <div class="mx-auto mt-8 flex h-[70vh] max-h-[640px] w-full max-w-[640px] flex-col rounded-lg border border-gray-300 bg-white shadow-lg">
          <div class="flex items-center justify-between border-b border-gray-200 px-3 py-2">
            <h3 class="text-sm font-semibold text-gray-800" data-folder-modal-title>Select folder</h3>
            <button
              type="button"
              class="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100"
              data-folder-cancel
            >
              Close
            </button>
          </div>
          <div class="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
            <button
              type="button"
              class="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              data-folder-up
            >
              Up
            </button>
            <p class="truncate text-[11px] text-gray-600" data-folder-path>Path: /</p>
          </div>
          <div class="flex-1 overflow-auto px-3 py-2 space-y-1" data-folder-items></div>
          <div class="border-t border-gray-100 px-3 py-2">
            <p class="text-[11px] text-gray-600 truncate" data-folder-selected>Selected: -</p>
          </div>
          <div class="flex items-center justify-end gap-2 border-t border-gray-200 px-3 py-2">
            <button
              type="button"
              class="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100"
              data-folder-cancel
            >
              Cancel
            </button>
            <button
              type="button"
              class="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              data-folder-confirm
              disabled
            >
              Use this folder
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

	const status = container.querySelector<HTMLElement>("[data-batch-status]");
	const content = container.querySelector<HTMLElement>("[data-batch-content]");
	const openFolderButtons = container.querySelectorAll<HTMLButtonElement>(
		"[data-open-folder-modal]",
	);
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
	const modal = container.querySelector<HTMLElement>("[data-folder-modal]");
	const modalTitle = container.querySelector<HTMLElement>(
		"[data-folder-modal-title]",
	);
	const modalPath = container.querySelector<HTMLElement>("[data-folder-path]");
	const modalItems = container.querySelector<HTMLElement>("[data-folder-items]");
	const modalSelected = container.querySelector<HTMLElement>(
		"[data-folder-selected]",
	);
	const modalUp = container.querySelector<HTMLButtonElement>("[data-folder-up]");
	const modalConfirm = container.querySelector<HTMLButtonElement>(
		"[data-folder-confirm]",
	);
	const modalCancelButtons = container.querySelectorAll<HTMLButtonElement>(
		"[data-folder-cancel]",
	);

	if (
		!status ||
		!content ||
		openFolderButtons.length === 0 ||
		!pdfLabel ||
		!ifcLabel ||
		!sizeSelect ||
		!batchButton ||
		!modal ||
		!modalTitle ||
		!modalPath ||
		!modalItems ||
		!modalSelected ||
		!modalUp ||
		!modalConfirm ||
		modalCancelButtons.length === 0
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

	const project = await api.project.getProject();
	if (!project?.id) {
		status.textContent = "No project selected.";
		return;
	}
	const token = await api.extension.requestPermission("accesstoken");
	if (token === "denied" || token === "pending") {
		status.textContent = `Access token ${token}. Please grant permission in extension settings.`;
		return;
	}
	const client = new TrimbleClient({
		accessToken: token,
		region: "eu",
		useDevProxy: import.meta.env.DEV,
	});

	const rootId = await client.getProjectRootId(project.id);
	const folderCache = new Map<string, FolderOption[]>();
	const modalState: FolderModalState = {
		open: false,
		target: "pdf",
		currentFolderId: rootId,
		crumbs: [{ id: rootId, name: "Project root" }],
		items: [],
		selectedId: "",
		selectedName: "",
		loading: false,
	};

	const renderModal = (): void => {
		modal.classList.toggle("hidden", !modalState.open);
		if (!modalState.open) return;

		modalTitle.textContent =
			modalState.target === "pdf" ? "Select PDF folder" : "Select IFC folder";
		modalPath.textContent = `Path: /${modalState.crumbs.map((c) => c.name).join("/")}`;
		modalSelected.textContent = modalState.selectedName
			? `Selected: ${modalState.selectedName}`
			: "Selected: -";
		modalUp.disabled = modalState.crumbs.length <= 1;
		modalConfirm.disabled = !modalState.selectedId;

		if (modalState.loading) {
			modalItems.innerHTML =
				'<p class="text-[11px] text-gray-500 italic">Loading folders...</p>';
			return;
		}
		if (!modalState.items.length) {
			modalItems.innerHTML =
				'<p class="text-[11px] text-gray-500 italic">No subfolders in this location.</p>';
			return;
		}
		modalItems.innerHTML = modalState.items
			.map(
				(f) => `
          <div class="flex items-center gap-2 rounded border border-gray-200 bg-white px-2 py-1">
            <button type="button" class="flex-1 text-left text-[11px] text-gray-800 hover:text-brand-700" data-folder-open data-id="${f.id}" data-name="${f.name}">
              ${f.name}
            </button>
            <button type="button" class="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-100" data-folder-select data-id="${f.id}" data-name="${f.name}">
              Select
            </button>
          </div>
        `,
			)
			.join("");
	};

	const listSubfolders = async (parentId: string): Promise<FolderOption[]> => {
		const items = await client.listFolderItems(parentId, project.id);
		const folders = (items ?? []).filter(
			(item) => item.type?.toUpperCase() === "FOLDER",
		);
		return folders
			.map((f) => ({
				id: f.id || f.versionId || "",
				name: f.name ?? "Folder",
				parentId: parentId,
			}))
			.filter((f) => f.id.length > 0)
			.sort((a, b) => a.name.localeCompare(b.name));
	};

	const loadCurrentModalFolder = async (): Promise<void> => {
		modalState.loading = true;
		renderModal();
		try {
			const cached = folderCache.get(modalState.currentFolderId);
			if (cached) {
				modalState.items = cached;
			} else {
				const items = await listSubfolders(modalState.currentFolderId);
				folderCache.set(modalState.currentFolderId, items);
				modalState.items = items;
			}
		} finally {
			modalState.loading = false;
			renderModal();
		}
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

	content.hidden = false;
	status.textContent =
		"Select the folders that contain your assembly PDFs and IFC models.";

	openFolderButtons.forEach((btn) => {
		btn.addEventListener("click", () => {
			const target = (btn.dataset.openFolderModal ?? "pdf") as FolderModalTarget;
			modalState.open = true;
			modalState.target = target;
			modalState.currentFolderId = rootId;
			modalState.crumbs = [{ id: rootId, name: "Project root" }];
			modalState.selectedId = "";
			modalState.selectedName = "";
			void loadCurrentModalFolder();
		});
	});
	modalCancelButtons.forEach((btn) => {
		btn.addEventListener("click", () => {
			modalState.open = false;
			renderModal();
		});
	});
	modalUp.addEventListener("click", () => {
		if (modalState.crumbs.length <= 1) return;
		modalState.crumbs.pop();
		modalState.currentFolderId = modalState.crumbs[modalState.crumbs.length - 1].id;
		void loadCurrentModalFolder();
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

	container.addEventListener("click", (event) => {
		const target = event.target as HTMLElement;
		const openNode = target.closest<HTMLElement>("[data-folder-open]");
		if (openNode) {
			const id = openNode.dataset.id ?? "";
			const name = openNode.dataset.name ?? "Folder";
			if (!id) return;
			modalState.currentFolderId = id;
			modalState.crumbs.push({ id, name });
			modalState.selectedId = "";
			modalState.selectedName = "";
			void loadCurrentModalFolder();
			return;
		}
		const selectNode = target.closest<HTMLElement>("[data-folder-select]");
		if (selectNode) {
			const id = selectNode.dataset.id ?? "";
			const name = selectNode.dataset.name ?? "Folder";
			if (!id) return;
			modalState.selectedId = id;
			modalState.selectedName = name;
			renderModal();
			return;
		}

		if (target.closest("[data-folder-confirm]")) {
			if (!modalState.selectedId) return;
			if (modalState.target === "pdf") {
				state.pdfFolderId = modalState.selectedId;
				state.pdfFolderName = modalState.selectedName;
				pdfLabel.textContent = `PDF folder: ${modalState.selectedName}`;
			} else {
				state.ifcFolderId = modalState.selectedId;
				state.ifcFolderName = modalState.selectedName;
				ifcLabel.textContent = `IFC folder: ${modalState.selectedName}`;
			}
			modalState.open = false;
			renderModal();
			refreshUi();
		}
	});

	batchButton.addEventListener("click", () => {
		if (batchButton.disabled) return;
		status.textContent =
			`Would generate QRs for PDFs in "${state.pdfFolderName}" using IFCs in "${state.ifcFolderName}" (${state.position}, ${state.size}). Backend integration pending.`;
	});

	refreshUi();
}

