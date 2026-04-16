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
	parentId?: string;
};

type FolderBrowserState = {
	currentFolderId: string;
	crumbs: Array<{ id: string; name: string }>;
	items: FolderOption[];
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
            data-open-pdf-browser
          >
            Select PDF folder...
          </button>
          <p class="text-[11px] text-gray-500 truncate" data-selected-pdf-folder>
            No PDF folder selected.
          </p>
          <div class="hidden rounded border border-gray-200 p-2 bg-gray-50" data-pdf-browser>
            <div class="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                class="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100"
                data-pdf-up
              >
                Up
              </button>
              <p class="text-[11px] text-gray-600 truncate flex-1 text-right" data-pdf-path>Path: /</p>
            </div>
            <div class="max-h-40 overflow-auto space-y-1" data-pdf-items></div>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <p class="text-xs font-medium text-gray-700">IFC folder</p>
          <button
            type="button"
            class="inline-flex items-center justify-center rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            data-open-ifc-browser
          >
            Select IFC folder...
          </button>
          <p class="text-[11px] text-gray-500 truncate" data-selected-ifc-folder>
            No IFC folder selected.
          </p>
          <div class="hidden rounded border border-gray-200 p-2 bg-gray-50" data-ifc-browser>
            <div class="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                class="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100"
                data-ifc-up
              >
                Up
              </button>
              <p class="text-[11px] text-gray-600 truncate flex-1 text-right" data-ifc-path>Path: /</p>
            </div>
            <div class="max-h-40 overflow-auto space-y-1" data-ifc-items></div>
          </div>
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
	const pdfOpenButton = container.querySelector<HTMLButtonElement>(
		"[data-open-pdf-browser]",
	);
	const ifcOpenButton = container.querySelector<HTMLButtonElement>(
		"[data-open-ifc-browser]",
	);
	const pdfBrowser = container.querySelector<HTMLElement>("[data-pdf-browser]");
	const ifcBrowser = container.querySelector<HTMLElement>("[data-ifc-browser]");
	const pdfUpButton = container.querySelector<HTMLButtonElement>("[data-pdf-up]");
	const ifcUpButton = container.querySelector<HTMLButtonElement>("[data-ifc-up]");
	const pdfPath = container.querySelector<HTMLElement>("[data-pdf-path]");
	const ifcPath = container.querySelector<HTMLElement>("[data-ifc-path]");
	const pdfItems = container.querySelector<HTMLElement>("[data-pdf-items]");
	const ifcItems = container.querySelector<HTMLElement>("[data-ifc-items]");
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
		!pdfOpenButton ||
		!ifcOpenButton ||
		!pdfBrowser ||
		!ifcBrowser ||
		!pdfUpButton ||
		!ifcUpButton ||
		!pdfPath ||
		!ifcPath ||
		!pdfItems ||
		!ifcItems ||
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
	const rootCrumb = [{ id: rootId, name: "Project root" }];
	const pdfTree: FolderBrowserState = {
		currentFolderId: rootId,
		crumbs: [...rootCrumb],
		items: [],
		loading: false,
	};
	const ifcTree: FolderBrowserState = {
		currentFolderId: rootId,
		crumbs: [...rootCrumb],
		items: [],
		loading: false,
	};

	const renderFolderItems = (
		target: "pdf" | "ifc",
		tree: FolderBrowserState,
		targetItems: HTMLElement,
		pathEl: HTMLElement,
	): void => {
		pathEl.textContent = `Path: /${tree.crumbs.map((c) => c.name).join("/")}`;
		if (tree.loading) {
			targetItems.innerHTML =
				'<p class="text-[11px] text-gray-500 italic">Loading folders...</p>';
			return;
		}
		if (!tree.items.length) {
			targetItems.innerHTML =
				'<p class="text-[11px] text-gray-500 italic">No subfolders in this location.</p>';
			return;
		}
		targetItems.innerHTML = tree.items
			.map(
				(f) => `
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-left text-[11px] text-gray-700 hover:bg-gray-100"
              data-folder-open-${target}
              data-id="${f.id}"
              data-name="${f.name}"
            >
              ${f.name}
            </button>
            <button
              type="button"
              class="rounded bg-brand-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-brand-700"
              data-folder-select-${target}
              data-id="${f.id}"
              data-name="${f.name}"
            >
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
				parentId,
			}))
			.filter((f) => f.id.length > 0)
			.sort((a, b) => a.name.localeCompare(b.name));
	};

	const loadTree = async (
		target: "pdf" | "ifc",
		tree: FolderBrowserState,
		targetItems: HTMLElement,
		pathEl: HTMLElement,
	): Promise<void> => {
		tree.loading = true;
		renderFolderItems(target, tree, targetItems, pathEl);
		try {
			tree.items = await listSubfolders(tree.currentFolderId);
		} finally {
			tree.loading = false;
			renderFolderItems(target, tree, targetItems, pathEl);
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
	await Promise.all([
		loadTree("pdf", pdfTree, pdfItems, pdfPath),
		loadTree("ifc", ifcTree, ifcItems, ifcPath),
	]);

	pdfOpenButton.addEventListener("click", () => {
		pdfBrowser.classList.toggle("hidden");
	});
	ifcOpenButton.addEventListener("click", () => {
		ifcBrowser.classList.toggle("hidden");
	});

	pdfUpButton.addEventListener("click", () => {
		if (pdfTree.crumbs.length <= 1) return;
		pdfTree.crumbs.pop();
		const prev = pdfTree.crumbs[pdfTree.crumbs.length - 1];
		pdfTree.currentFolderId = prev.id;
		void loadTree("pdf", pdfTree, pdfItems, pdfPath);
	});
	ifcUpButton.addEventListener("click", () => {
		if (ifcTree.crumbs.length <= 1) return;
		ifcTree.crumbs.pop();
		const prev = ifcTree.crumbs[ifcTree.crumbs.length - 1];
		ifcTree.currentFolderId = prev.id;
		void loadTree("ifc", ifcTree, ifcItems, ifcPath);
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

		const openPdf = target.closest<HTMLElement>("[data-folder-open-pdf]");
		if (openPdf) {
			const id = openPdf.dataset.id ?? "";
			const name = openPdf.dataset.name ?? "Folder";
			if (!id) return;
			pdfTree.currentFolderId = id;
			pdfTree.crumbs.push({ id, name });
			void loadTree("pdf", pdfTree, pdfItems, pdfPath);
			return;
		}
		const openIfc = target.closest<HTMLElement>("[data-folder-open-ifc]");
		if (openIfc) {
			const id = openIfc.dataset.id ?? "";
			const name = openIfc.dataset.name ?? "Folder";
			if (!id) return;
			ifcTree.currentFolderId = id;
			ifcTree.crumbs.push({ id, name });
			void loadTree("ifc", ifcTree, ifcItems, ifcPath);
			return;
		}

		const selectPdf = target.closest<HTMLElement>("[data-folder-select-pdf]");
		if (selectPdf) {
			const id = selectPdf.dataset.id ?? "";
			const name = selectPdf.dataset.name ?? "Folder";
			if (!id) return;
			state.pdfFolderId = id;
			state.pdfFolderName = name;
			pdfLabel.textContent = `PDF folder: ${name}`;
			pdfBrowser.classList.add("hidden");
			refreshUi();
			return;
		}
		const selectIfc = target.closest<HTMLElement>("[data-folder-select-ifc]");
		if (selectIfc) {
			const id = selectIfc.dataset.id ?? "";
			const name = selectIfc.dataset.name ?? "Folder";
			if (!id) return;
			state.ifcFolderId = id;
			state.ifcFolderName = name;
			ifcLabel.textContent = `IFC folder: ${name}`;
			ifcBrowser.classList.add("hidden");
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

