import { escapeHtml } from "@imasd/shared";
import type { WorkspaceApi } from "@imasd/shared/trimble";
import { read, utils } from "xlsx";
import {
	fetchIfcAssembliesFromFile,
	fetchProjectIfcModels,
} from "../services/folders";
import { writeWbsPropertySetValues } from "../services/pset";

type WbsTableData = {
	headers: string[];
	rows: string[][];
};

const WBS_STORAGE_KEY = "smartprintpro:wbs:uploaded-file";
const WBS_ASSIGNMENTS_STORAGE_KEY = "smartprintpro:wbs:assignments";

type StoredWbsFile = {
	name: string;
	mimeType: string;
	base64: string;
};

type IfcPart = {
	id: string;
	name: string;
	type: string;
	material: string;
	modelId?: string;
	modelName?: string;
	link?: string;
};

type WbsAssignment = {
	partId: string;
	modelId?: string;
	partName: string;
	partType: string;
	partMaterial: string;
	wbsRowIndex: number;
	wbsValues: string[];
	propertySetName: "Pset_IMASD_WBS";
	propertySetValue: string;
	assignedAt: string;
};

type IfcModelOption = {
	id: string;
	versionId?: string;
	name: string;
};

export type RenderWbsOptions = {
	/** 3D manifest: only models open in the viewer (no project folder IFC list). */
	useViewerModelOnly?: boolean;
	/** Wide bottom band: Excel + assemblies side by side (3D viewer). */
	horizontalDockLayout?: boolean;
};

function parseWorkbookToTableData(fileBuffer: ArrayBuffer): WbsTableData {
	const workbook = read(fileBuffer, { type: "array" });
	const firstSheetName = workbook.SheetNames[0];
	if (!firstSheetName) {
		return { headers: [], rows: [] };
	}

	const worksheet = workbook.Sheets[firstSheetName];
	const matrix = utils.sheet_to_json<(string | number | boolean | null)[]>(
		worksheet,
		{
			header: 1,
			raw: false,
			defval: "",
			blankrows: false,
		},
	);

	// Business rule for WBS template:
	// - Row 3 (index 2) is the header
	// - Row 4+ (index 3+) is data
	// - Only columns A-D (index 0..3) are relevant
	const HEADER_ROW_INDEX = 2;
	const DATA_START_INDEX = 3;
	const MAX_COLUMNS = 4;

	if (matrix.length <= HEADER_ROW_INDEX) {
		return { headers: [], rows: [] };
	}

	const rawHeaders = matrix[HEADER_ROW_INDEX] ?? [];
	const headers = Array.from({ length: MAX_COLUMNS }, (_, index) => {
		const value = String(rawHeaders[index] ?? "").trim();
		return value || `Column ${index + 1}`;
	});

	const rows = matrix
		.slice(DATA_START_INDEX)
		.map((row) =>
			Array.from({ length: MAX_COLUMNS }, (_, index) => String(row[index] ?? "")),
		)
		.filter((row) => row.some((cell) => cell.trim().length > 0));

	return { headers, rows };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let index = 0; index < bytes.length; index += 1) {
		binary += String.fromCharCode(bytes[index]);
	}
	return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes.buffer;
}

function saveFileToLocalStorage(file: File, fileBuffer: ArrayBuffer): void {
	const payload: StoredWbsFile = {
		name: file.name,
		mimeType: file.type,
		base64: arrayBufferToBase64(fileBuffer),
	};
	localStorage.setItem(WBS_STORAGE_KEY, JSON.stringify(payload));
}

function loadFileFromLocalStorage(): StoredWbsFile | null {
	try {
		const raw = localStorage.getItem(WBS_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<StoredWbsFile>;
		if (!parsed.name || !parsed.base64) return null;
		return {
			name: parsed.name,
			mimeType: parsed.mimeType ?? "",
			base64: parsed.base64,
		};
	} catch {
		return null;
	}
}

function loadAssignmentsFromLocalStorage(): WbsAssignment[] {
	try {
		const raw = localStorage.getItem(WBS_ASSIGNMENTS_STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as WbsAssignment[];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function saveAssignmentsToLocalStorage(assignments: WbsAssignment[]): void {
	localStorage.setItem(WBS_ASSIGNMENTS_STORAGE_KEY, JSON.stringify(assignments));
}

function renderTable(
	tableData: WbsTableData,
	selectedRowIndex: number | null,
	wbsFilter: string,
	descriptionFilter: string,
	tableScrollClass = "max-h-[62vh] overflow-auto",
	compactOuter = false,
): string {
	if (!tableData.headers.length) {
		return '<p class="text-sm text-gray-500 italic">No data found in the selected file.</p>';
	}
	const outerClass = compactOuter
		? "flex flex-col flex-1 min-h-0 min-w-0"
		: "rounded-lg border border-gray-200 overflow-hidden";

	const normalizedWbsFilter = wbsFilter.trim().toLowerCase();
	const normalizedDescriptionFilter = descriptionFilter.trim().toLowerCase();
	const visibleRows = tableData.rows
		.map((row, sourceIndex) => ({ row, sourceIndex }))
		.filter(({ row }) => {
			const wbsValue = (row[1] ?? "").toLowerCase();
			const descriptionValue = (row[3] ?? "").toLowerCase();
			const matchesWbs =
				!normalizedWbsFilter || wbsValue.includes(normalizedWbsFilter);
			const matchesDescription =
				!normalizedDescriptionFilter ||
				descriptionValue.includes(normalizedDescriptionFilter);
			return matchesWbs && matchesDescription;
		});

	const headerCells = tableData.headers
		.map(
			(header) =>
				`<th class="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 bg-gray-50 border-b border-gray-200">${escapeHtml(header)}</th>`,
		)
		.join("");

	const bodyRows = visibleRows.length
		? visibleRows
				.map(({ row, sourceIndex }) => {
					const isSelected = selectedRowIndex === sourceIndex;
					const cellClass = isSelected
						? "px-3 py-2 text-sm text-white border-b border-brand-600 align-top"
						: "px-3 py-2 text-sm text-gray-800 border-b border-gray-100 align-top";
					const cells = row
						.map(
							(cell) =>
								`<td class="${cellClass}">${escapeHtml(cell)}</td>`,
						)
						.join("");
					return `<tr class="cursor-pointer ${isSelected ? "bg-brand-700" : "hover:bg-gray-50"}" data-wbs-row="${sourceIndex}">${cells}</tr>`;
				})
				.join("")
		: `<tr><td class="px-3 py-3 text-sm text-gray-500 italic" colspan="${tableData.headers.length}">No rows found.</td></tr>`;

	return `
    <div class="${outerClass}">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2 p-2 border-b border-gray-200 bg-gray-50 shrink-0">
        <input
          type="text"
          value="${escapeHtml(wbsFilter)}"
          placeholder="Filter WBS (column B)"
          class="w-full rounded border border-gray-300 px-2 py-1 text-sm"
          data-wbs-filter
        />
        <input
          type="text"
          value="${escapeHtml(descriptionFilter)}"
          placeholder="Filter Description (column D)"
          class="w-full rounded border border-gray-300 px-2 py-1 text-sm"
          data-description-filter
        />
      </div>
      <div class="${tableScrollClass}">
        <table class="min-w-full border-collapse">
          <thead class="sticky top-0 z-10">
            <tr>${headerCells}</tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderPartsList(
	parts: IfcPart[],
	selectedPartIds: Set<string>,
	typeFilter: string,
	materialFilter: string,
): string {
	const filtered = parts.filter((part) => {
		const typeMatches = typeFilter === "ALL" || part.type === typeFilter;
		const materialMatches =
			materialFilter === "ALL" || part.material === materialFilter;
		return typeMatches && materialMatches;
	});

	if (!filtered.length) {
		return '<p class="text-sm text-gray-500 italic">No parts found with current filters.</p>';
	}

	return filtered
		.map((part) => {
			const checked = selectedPartIds.has(part.id) ? "checked" : "";
			return `
        <label class="flex items-center gap-2 rounded border border-gray-200 px-2 py-2 hover:bg-gray-50">
          <input type="checkbox" data-part-id="${escapeHtml(part.id)}" ${checked} />
          <span class="text-sm text-gray-800">${escapeHtml(part.name)}</span>
          <span class="ml-auto text-xs text-gray-500">${escapeHtml(part.type)} | ${escapeHtml(part.material)}</span>
        </label>
      `;
		})
		.join("");
}

function renderAssignmentsList(assignments: WbsAssignment[]): string {
	if (!assignments.length) {
		return '<p class="text-sm text-gray-500 italic">No assignments yet.</p>';
	}

	const rows = assignments
		.slice()
		.reverse()
		.map((item) => {
			const fallbackValue = `${item.wbsValues?.[1] ?? ""} - ${item.wbsValues?.[3] ?? ""}`;
			const assignedValue = item.propertySetValue || fallbackValue;
			return `
      <tr class="hover:bg-gray-50">
        <td class="px-2 py-2 text-sm text-gray-800 border-b border-gray-100">${escapeHtml(item.partName)}</td>
        <td class="px-2 py-2 text-xs text-gray-600 border-b border-gray-100">${escapeHtml(item.partType)}</td>
        <td class="px-2 py-2 text-xs text-gray-600 border-b border-gray-100">${escapeHtml(item.partMaterial)}</td>
        <td class="px-2 py-2 text-xs text-gray-700 border-b border-gray-100">${escapeHtml(item.propertySetName)}</td>
        <td class="px-2 py-2 text-xs text-gray-800 border-b border-gray-100">${escapeHtml(assignedValue)}</td>
        <td class="px-2 py-2 text-xs text-gray-600 border-b border-gray-100">${item.wbsRowIndex + 4}</td>
      </tr>
    `;
		})
		.join("");

	return `
    <div class="rounded border border-gray-200 overflow-hidden">
      <div class="max-h-[24vh] overflow-auto">
        <table class="min-w-full border-collapse">
          <thead class="sticky top-0 bg-gray-50 z-10">
            <tr>
              <th class="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 border-b border-gray-200">Part</th>
              <th class="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 border-b border-gray-200">Type</th>
              <th class="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 border-b border-gray-200">Material</th>
              <th class="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 border-b border-gray-200">Pset</th>
              <th class="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 border-b border-gray-200">Assigned Value</th>
              <th class="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 border-b border-gray-200">WBS Row</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

export async function renderWbs(
	container: HTMLElement,
	api: WorkspaceApi,
	options?: RenderWbsOptions,
): Promise<void> {
	const viewerOnly = options?.useViewerModelOnly === true;
	const dockLayout = viewerOnly && options?.horizontalDockLayout === true;

	if (dockLayout) {
		container.innerHTML = `
    <div class="flex flex-col h-full min-h-0 gap-2 text-gray-900" data-wbs-root>
      <div class="flex flex-wrap items-end gap-2 border-b border-gray-200 pb-2 shrink-0">
        <div class="flex flex-col min-w-0">
          <h2 class="text-base font-semibold leading-tight">WBS</h2>
          <p class="text-xs text-gray-500">Excel (A–D) · IFC assemblies · Pset_IMASD_WBS</p>
        </div>
        <div class="flex flex-wrap items-center gap-2 flex-1 min-w-0 justify-end">
          <input
            id="wbs-file"
            type="file"
            accept=".xlsx,.xls"
            class="min-w-0 block text-sm text-gray-700 file:mr-2 file:rounded file:border-0 file:bg-brand-50 file:px-2 file:py-1.5 file:font-medium file:text-brand-700 hover:file:bg-brand-100"
          />
          <button
            type="button"
            class="shrink-0 rounded px-3 py-1.5 text-sm font-medium bg-brand-600 text-white hover:bg-brand-700"
            data-wbs-upload
          >
            Upload
          </button>
          <span class="text-xs text-gray-600 whitespace-nowrap hidden sm:inline">IFC model</span>
          <select class="min-w-[140px] max-w-[240px] rounded border border-gray-300 px-2 py-1 text-sm" data-model-filter>
            <option value="">Detecting viewer model…</option>
          </select>
          <button
            type="button"
            class="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            data-retry-assemblies
          >
            Retry
          </button>
        </div>
      </div>
      <p class="shrink-0 text-xs text-gray-600" data-wbs-status>No file uploaded yet. Expected: Excel template (.xlsx / .xls).</p>

      <div class="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-2 min-h-0 overflow-hidden">
        <div class="flex flex-col min-h-0 rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div class="px-2 py-1.5 bg-gray-100 border-b border-gray-200 flex items-center justify-between gap-2 shrink-0">
            <span class="text-xs font-semibold text-gray-700">WBS (Excel)</span>
            <span class="text-xs text-gray-500">Header row 3 · columns A–D</span>
          </div>
          <div class="flex-1 min-h-0 flex flex-col p-2 overflow-hidden" data-wbs-table>
            <p class="text-sm text-gray-400 italic">Upload a WBS file to preview and select a row.</p>
          </div>
        </div>
        <div class="flex flex-col min-h-0 rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div class="px-2 py-1.5 bg-gray-100 border-b border-gray-200 shrink-0">
            <span class="text-xs font-semibold text-gray-700">IFC assemblies</span>
            <p class="text-xs text-gray-500 mt-0.5" data-viewer-hint>From the model open in 3D (not the project folder).</p>
          </div>
          <div class="px-2 pt-2 grid grid-cols-2 gap-2 shrink-0">
            <select class="rounded border border-gray-300 px-2 py-1 text-sm" data-type-filter>
              <option value="ALL">All Types</option>
            </select>
            <select class="rounded border border-gray-300 px-2 py-1 text-sm" data-material-filter>
              <option value="ALL">All Materials</option>
            </select>
          </div>
          <div class="px-2 pt-1 flex items-center justify-between gap-2 shrink-0">
            <p class="text-xs text-gray-500" data-assembly-last-checked>Last checked: -</p>
          </div>
          <div class="flex-1 min-h-0 overflow-auto px-2 pb-2 space-y-2" data-parts-list>
            <p class="text-sm text-gray-400 italic">Loading parts...</p>
          </div>
          <div class="px-2 pb-2 shrink-0 border-t border-gray-100">
            <button
              type="button"
              class="w-full rounded px-3 py-2 text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
              data-assign
              disabled
            >
              Assign selected assemblies to selected WBS row
            </button>
            <p class="text-xs text-gray-500 mt-1">Writes Pset_IMASD_WBS on the open IFC.</p>
          </div>
        </div>
      </div>

      <div class="shrink-0 flex flex-col min-h-0 max-h-[32vh] border-t border-gray-200 pt-2">
        <h3 class="text-xs font-semibold text-gray-700 mb-1">Assigned property sets (Pset_IMASD_WBS)</h3>
        <div class="flex-1 min-h-0 overflow-auto" data-assignments-list>
          <p class="text-sm text-gray-400 italic">No assignments yet.</p>
        </div>
      </div>
    </div>
  `;
	} else {
		container.innerHTML = `
    <div class="rounded-lg border border-gray-200 p-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">WBS</h2>
          <p class="mt-1 text-sm text-gray-500">Upload Excel, preview columns A–D, assign rows to IFC parts${
						viewerOnly ? " (uses the model open in 3D)" : ""
					}</p>
        </div>
        <div class="flex items-center gap-2">
          <input
            id="wbs-file"
            type="file"
            accept=".xlsx,.xls"
            class="min-w-0 block text-sm text-gray-700 file:mr-2 file:rounded file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-medium file:text-brand-700 hover:file:bg-brand-100"
          />
          <button
            type="button"
            class="shrink-0 rounded px-4 py-2 text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
            data-wbs-upload
          >
            Upload File
          </button>
        </div>
      </div>
      <p class="mt-2 text-sm text-gray-600" data-wbs-status>No file uploaded yet. Expected file type: Excel template (.xlsx).</p>
    </div>

    <div class="mt-3 space-y-3">

      <div class="grid grid-cols-12 gap-4">
        <div class="col-span-12 lg:col-span-6 rounded-lg border border-gray-200 p-3 space-y-2">
          <h3 class="text-sm font-semibold text-gray-700">${
						viewerOnly ? "IFC parts (3D viewer)" : "IFC Parts (MVP)"
					}</h3>
          ${
						viewerOnly
							? `<p class="text-xs text-gray-500" data-viewer-hint>Parts come from the model loaded in the viewer — no project folder scan.</p>`
							: ""
					}

          <div class="${viewerOnly ? "hidden" : ""}">
            <label class="mb-1 block text-xs font-medium text-gray-600">Filter IFC models</label>
            <input
              type="text"
              class="mb-2 w-full rounded border border-gray-300 px-2 py-1 text-sm"
              data-model-search
              placeholder="Type to filter by name..."
            />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-600">${
							viewerOnly ? "Loaded model" : "IFC Model"
						}</label>
            <select class="w-full rounded border border-gray-300 px-2 py-1 text-sm" data-model-filter>
              <option value="">${
								viewerOnly ? "Detecting viewer model…" : "Select IFC model"
							}</option>
            </select>
            <div class="mt-2 flex items-center justify-between gap-2">
              <p class="text-xs text-gray-500" data-assembly-last-checked>Last checked: -</p>
              <button
                type="button"
                class="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                data-retry-assemblies
              >
                Retry
              </button>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <select class="rounded border border-gray-300 px-2 py-1 text-sm" data-type-filter>
              <option value="ALL">All Types</option>
            </select>
            <select class="rounded border border-gray-300 px-2 py-1 text-sm" data-material-filter>
              <option value="ALL">All Materials</option>
            </select>
          </div>

          <div class="max-h-[52vh] overflow-auto space-y-2" data-parts-list>
            <p class="text-sm text-gray-400 italic">Loading parts...</p>
          </div>

          <button
            type="button"
            class="w-full rounded px-3 py-2 text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
            data-assign
            disabled
          >
            Assign Selected Parts to Selected WBS Row
          </button>
          <p class="text-xs text-gray-500">Assignments are stored in local Pset_IMASD_WBS mapping for now.</p>
        </div>

        <div class="col-span-12 lg:col-span-6" data-wbs-table>
          <p class="text-sm text-gray-400 italic">Upload a WBS file to preview and select a row.</p>
        </div>
      </div>

      <div class="rounded-lg border border-gray-200 p-2">
        <h3 class="text-sm font-semibold text-gray-700">Assigned Property Set Values (Pset_IMASD_WBS)</h3>
        <div class="mt-2 max-h-[22vh] overflow-auto" data-assignments-list>
          <p class="text-sm text-gray-400 italic">No assignments yet.</p>
        </div>
      </div>
    </div>
  `;
	}

	const fileInput = container.querySelector<HTMLInputElement>("#wbs-file");
	const uploadButton = container.querySelector<HTMLButtonElement>("[data-wbs-upload]");
	const status = container.querySelector<HTMLElement>("[data-wbs-status]");
	const tableContainer = container.querySelector<HTMLElement>("[data-wbs-table]");
	const typeFilter = container.querySelector<HTMLSelectElement>("[data-type-filter]");
	const materialFilter = container.querySelector<HTMLSelectElement>(
		"[data-material-filter]",
	);
	const modelFilter = container.querySelector<HTMLSelectElement>("[data-model-filter]");
	const modelSearch = container.querySelector<HTMLInputElement>("[data-model-search]");
	const retryAssembliesButton = container.querySelector<HTMLButtonElement>(
		"[data-retry-assemblies]",
	);
	const lastCheckedLabel = container.querySelector<HTMLElement>(
		"[data-assembly-last-checked]",
	);
	const partsList = container.querySelector<HTMLElement>("[data-parts-list]");
	const assignButton = container.querySelector<HTMLButtonElement>("[data-assign]");
	const assignmentsList = container.querySelector<HTMLElement>(
		"[data-assignments-list]",
	);

	if (
		!fileInput ||
		!uploadButton ||
		!status ||
		!tableContainer ||
		!typeFilter ||
		!materialFilter ||
		!modelFilter ||
		(!viewerOnly && !modelSearch) ||
		!retryAssembliesButton ||
		!lastCheckedLabel ||
		!partsList ||
		!assignButton ||
		!assignmentsList
	) {
		return;
	}

	const tableContainerEl = tableContainer;
	const statusEl = status;
	const typeFilterEl = typeFilter;
	const materialFilterEl = materialFilter;
	const modelFilterEl = modelFilter;
	const modelSearchEl = modelSearch as HTMLInputElement | null;
	const retryAssembliesButtonEl = retryAssembliesButton;
	const lastCheckedLabelEl = lastCheckedLabel;
	const partsListEl = partsList;
	const assignButtonEl = assignButton;
	const assignmentsListEl = assignmentsList;

	function setStatus(
		message: string,
		tone: "info" | "error" = "info",
	): void {
		statusEl.textContent = message;
		statusEl.classList.remove("text-gray-600", "text-red-600");
		statusEl.classList.add(tone === "error" ? "text-red-600" : "text-gray-600");
	}

	let tableData: WbsTableData = { headers: [], rows: [] };
	let selectedWbsRowIndex: number | null = null;
	let wbsFilterValue = "";
	let descriptionFilterValue = "";
	let allIfcModels: IfcModelOption[] = [];
	const partsByModelId = new Map<string, IfcPart[]>();
	let parts: IfcPart[] = [];
	const selectedPartIds = new Set<string>();
	let assignments = loadAssignmentsFromLocalStorage();

	function refreshAssignments(): void {
		assignmentsListEl.innerHTML = renderAssignmentsList(assignments);
	}

	function refreshAssignButton(): void {
		assignButtonEl.disabled =
			selectedWbsRowIndex === null || selectedPartIds.size === 0 || !tableData.rows.length;
	}

	function refreshPartsList(): void {
		if (!modelFilterEl.value) {
			partsListEl.innerHTML =
				'<p class="text-sm text-gray-500 italic">Select an IFC model to load parts.</p>';
			refreshAssignButton();
			return;
		}

		partsListEl.innerHTML = renderPartsList(
			parts,
			selectedPartIds,
			typeFilterEl.value,
			materialFilterEl.value,
		);
		refreshAssignButton();
	}

	function refreshPartFilters(): void {
		const types = [...new Set(parts.map((part) => part.type))].sort();
		const materials = [...new Set(parts.map((part) => part.material))].sort();
		typeFilterEl.innerHTML =
			'<option value="ALL">All Types</option>' +
			types
				.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
				.join("");
		materialFilterEl.innerHTML =
			'<option value="ALL">All Materials</option>' +
			materials
				.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
				.join("");
	}

	function refreshWbsTable(
		preserveFocus?:
			| {
					field: "wbs" | "description";
					selectionStart: number;
					selectionEnd: number;
			  }
			| undefined,
	): void {
		tableContainerEl.innerHTML = renderTable(
			tableData,
			selectedWbsRowIndex,
			wbsFilterValue,
			descriptionFilterValue,
			dockLayout ? "flex-1 min-h-0 overflow-auto" : "max-h-[62vh] overflow-auto",
			dockLayout,
		);

		if (preserveFocus) {
			const selector =
				preserveFocus.field === "wbs"
					? "[data-wbs-filter]"
					: "[data-description-filter]";
			const input = tableContainerEl.querySelector<HTMLInputElement>(selector);
			if (input) {
				input.focus();
				input.setSelectionRange(
					preserveFocus.selectionStart,
					preserveFocus.selectionEnd,
				);
			}
		}
		refreshAssignButton();
	}

	function setLastCheckedNow(): void {
		const now = new Date();
		lastCheckedLabelEl.textContent = `Last checked: ${now.toLocaleTimeString()}`;
	}

	async function loadAssembliesForSelectedModel(forceRefetch: boolean): Promise<void> {
		selectedPartIds.clear();
		const selectedModelId = modelFilterEl.value;
		if (!selectedModelId) {
			parts = [];
			refreshPartFilters();
			refreshPartsList();
			setStatus("Select an IFC model to load parts.");
			return;
		}

		let loadMessage: string | null = null;
		const cachedParts = partsByModelId.get(selectedModelId);
		const shouldRefetch =
			forceRefetch ||
			!partsByModelId.has(selectedModelId) ||
			(cachedParts?.length ?? 0) === 0;
		if (shouldRefetch) {
			const selectedModel = allIfcModels.find((model) => model.id === selectedModelId);
			setStatus(
				`Loading assemblies for ${selectedModel?.name ?? "selected IFC"}… If the file is still processing, this may take up to a few minutes.`,
			);
			partsListEl.innerHTML =
				'<p class="text-sm text-gray-400 italic animate-pulse">Loading assemblies from IFC (waiting for model tree if processing)…</p>';
			retryAssembliesButtonEl.disabled = true;
			try {
				const assemblyPartsRaw = await fetchIfcAssembliesFromFile(
					api,
					selectedModelId,
					selectedModel?.versionId,
					selectedModel?.name,
				);
				const assemblyParts = assemblyPartsRaw.map((item) => ({
					id: item.id,
					name: item.name,
					type: item.type,
					material: item.material,
					modelId: selectedModelId,
					modelName: selectedModel?.name ?? "IFC",
					link: item.link,
				}));
				partsByModelId.set(selectedModelId, assemblyParts);
			} catch (error) {
				partsByModelId.set(selectedModelId, []);
				loadMessage =
					error instanceof Error
						? error.message
						: "Failed to read assemblies from viewer.";
				partsListEl.innerHTML = `<p class="text-sm text-red-600">${escapeHtml(loadMessage)}</p>`;
			} finally {
				retryAssembliesButtonEl.disabled = false;
				setLastCheckedNow();
			}
		}

		parts = partsByModelId.get(selectedModelId) ?? [];
		refreshPartFilters();
		refreshPartsList();
		const selectedModel = allIfcModels.find((model) => model.id === selectedModelId);
		if (loadMessage) {
			setStatus(loadMessage, "error");
			return;
		}

		if (parts.length === 0) {
			setStatus(
				`No assemblies found for ${selectedModel?.name ?? "selected IFC model"}. Check processing status, tree availability, or assembly naming in model tree.`,
				"error",
			);
			return;
		}

		setStatus(
			`Loaded ${parts.length} assembly item(s) for ${selectedModel?.name ?? "selected IFC model"}.`,
		);
		const hasNonAssembly = parts.some(
			(part) => !part.type.toLowerCase().includes("assembly"),
		);
		if (hasNonAssembly) {
			setStatus(
				`Debug mode: loaded ${parts.length} object node(s) for ${selectedModel?.name ?? "selected IFC model"} (not assembly-filtered).`,
				"error",
			);
		}
	}

	function refreshModelOptions(): void {
		const search = (modelSearchEl?.value ?? "").trim().toLowerCase();
		const filteredModels = allIfcModels.filter((model) =>
			model.name.toLowerCase().includes(search),
		);

		const currentSelection = modelFilterEl.value;
		modelFilterEl.innerHTML =
			'<option value="">Select IFC model</option>' +
			filteredModels
				.map(
					(model) =>
						`<option value="${escapeHtml(model.id)}">${escapeHtml(model.name)}</option>`,
				)
				.join("");

		if (filteredModels.some((model) => model.id === currentSelection)) {
			modelFilterEl.value = currentSelection;
			return;
		}

		modelFilterEl.value = "";
		selectedPartIds.clear();
		parts = [];
		refreshPartFilters();
		refreshPartsList();
	}

	try {
		if (viewerOnly) {
			setStatus("Loading model from 3D viewer…");
			if (!api.viewer?.getModels) {
				modelFilterEl.innerHTML =
					'<option value="">Viewer API unavailable</option>';
				partsByModelId.clear();
				setStatus(
					"Viewer API not available. Use the 3D manifest and open an IFC in the viewer.",
					"error",
				);
				refreshPartsList();
			} else {
				const models = await api.viewer.getModels();
				const list = (models ?? []) as Array<{
					id: string;
					versionId?: string;
					name?: string;
				}>;
				allIfcModels = list.map((m, i) => ({
					id: m.id,
					versionId: m.versionId,
					name: m.name ?? `Model ${i + 1}`,
				}));

				if (allIfcModels.length === 0) {
					modelFilterEl.innerHTML =
						'<option value="">No model in viewer</option>';
					partsByModelId.clear();
					setStatus(
						"No loaded model in the viewer. Open your IFC in 3D, then Retry.",
						"error",
					);
					refreshPartsList();
				} else {
					refreshModelOptions();
					if (!modelFilterEl.value && allIfcModels[0]) {
						modelFilterEl.value = allIfcModels[0].id;
					}
					setStatus(
						`Using ${allIfcModels.length} model(s) from the viewer. Select another if needed.`,
					);
					await loadAssembliesForSelectedModel(false);
				}
			}
		} else {
			setStatus("Loading IFC models from project folders...");
			const ifcModels = await fetchProjectIfcModels(api);
			allIfcModels = ifcModels.map((model, index) => ({
				id: model.id || model.versionId || `ifc-${index + 1}`,
				versionId: model.versionId,
				name: model.name || `IFC ${index + 1}`,
			}));

			if (allIfcModels.length > 0) {
				refreshModelOptions();
				setStatus(
					`Found ${allIfcModels.length} IFC file(s). Select one to load assemblies.`,
				);
			} else {
				modelFilterEl.innerHTML =
					'<option value="">No IFC files found in project folders</option>';
				partsByModelId.clear();
				setStatus("No IFC files found in project folders.", "error");
			}

			refreshPartsList();
		}
	} catch {
		modelFilterEl.innerHTML = viewerOnly
			? '<option value="">Failed to read viewer models</option>'
			: '<option value="">Failed to load IFC files from project</option>';
		partsByModelId.clear();
		refreshPartsList();
		setStatus(
			viewerOnly
				? "Failed to load models from the 3D viewer."
				: "Failed to load IFC files from project.",
			"error",
		);
	}

	refreshAssignments();

	const cachedFile = loadFileFromLocalStorage();
	if (cachedFile) {
		try {
			tableData = parseWorkbookToTableData(base64ToArrayBuffer(cachedFile.base64));
			refreshWbsTable();
			status.textContent = `Loaded ${cachedFile.name} from local storage (${tableData.rows.length} rows). Select a WBS row.`;
		} catch {
			setStatus("Stored WBS file is invalid. Please upload again.", "error");
			localStorage.removeItem(WBS_STORAGE_KEY);
		}
	}

	modelSearchEl?.addEventListener("input", refreshModelOptions);

	modelFilterEl.addEventListener("change", async () => {
		await loadAssembliesForSelectedModel(false);
	});

	retryAssembliesButtonEl.addEventListener("click", async () => {
		await loadAssembliesForSelectedModel(true);
	});

	typeFilterEl.addEventListener("change", refreshPartsList);
	materialFilterEl.addEventListener("change", refreshPartsList);

	container.addEventListener("change", (event) => {
		const target = event.target as HTMLElement;
		const partCheckbox = target.closest<HTMLInputElement>("[data-part-id]");
		if (!partCheckbox) return;
		const partId = partCheckbox.dataset.partId;
		if (!partId) return;
		if (partCheckbox.checked) {
			selectedPartIds.add(partId);
		} else {
			selectedPartIds.delete(partId);
		}
		refreshAssignButton();
	});

	container.addEventListener("click", (event) => {
		const target = event.target as HTMLElement;
		const row = target.closest<HTMLTableRowElement>("[data-wbs-row]");
		if (!row) return;
		const indexRaw = row.dataset.wbsRow;
		if (indexRaw == null) return;
		selectedWbsRowIndex = Number(indexRaw);
		refreshWbsTable();
	});

	container.addEventListener("input", (event) => {
		const target = event.target as HTMLElement;
		const wbsFilterInput = target.closest<HTMLInputElement>("[data-wbs-filter]");
		if (wbsFilterInput) {
			wbsFilterValue = wbsFilterInput.value;
			refreshWbsTable({
				field: "wbs",
				selectionStart: wbsFilterInput.selectionStart ?? wbsFilterInput.value.length,
				selectionEnd: wbsFilterInput.selectionEnd ?? wbsFilterInput.value.length,
			});
			return;
		}

		const descriptionFilterInput = target.closest<HTMLInputElement>(
			"[data-description-filter]",
		);
		if (descriptionFilterInput) {
			descriptionFilterValue = descriptionFilterInput.value;
			refreshWbsTable({
				field: "description",
				selectionStart:
					descriptionFilterInput.selectionStart ??
					descriptionFilterInput.value.length,
				selectionEnd:
					descriptionFilterInput.selectionEnd ??
					descriptionFilterInput.value.length,
			});
		}
	});

	assignButtonEl.addEventListener("click", () => {
		if (selectedWbsRowIndex === null) return;
		const assignedRowIndex = selectedWbsRowIndex;
		const selectedRow = tableData.rows[selectedWbsRowIndex];
		if (!selectedRow) return;

		const selectedParts = parts.filter((part) => selectedPartIds.has(part.id));
		const now = new Date().toISOString();

		selectedParts.forEach((part) => {
			assignments = assignments.filter((item) => item.partId !== part.id);
			const columnB = (selectedRow[1] ?? "").trim();
			const columnD = (selectedRow[3] ?? "").trim();
			const propertySetValue = `${columnB} - ${columnD}`;
			assignments.push({
				partId: part.id,
				partName: part.name,
				partType: part.type,
				partMaterial: part.material,
				modelId: part.modelId ?? modelFilterEl.value,
				wbsRowIndex: assignedRowIndex,
				wbsValues: selectedRow,
				propertySetName: "Pset_IMASD_WBS",
				propertySetValue,
				assignedAt: now,
			});
		});

		const psetWriteItems = selectedParts.map((part) => {
			const columnB = (selectedRow[1] ?? "").trim();
			const columnD = (selectedRow[3] ?? "").trim();
			const propertySetValue = `${columnB} - ${columnD}`;
			return {
				modelId: part.modelId ?? modelFilterEl.value,
				partId: part.id,
				value: propertySetValue,
				link: part.link,
			};
		});

		writeWbsPropertySetValues(api, psetWriteItems)
			.then(() => {
				saveAssignmentsToLocalStorage(assignments);
				refreshAssignments();
				setStatus(
					`Assigned WBS row ${assignedRowIndex + 4} to ${selectedParts.length} part(s) and updated Pset_IMASD_WBS.`,
				);
			})
			.catch((error) => {
				const message =
					error instanceof Error ? error.message : "Failed to write property set.";
				setStatus(
					`Assignment saved locally, but Pset write failed: ${message}`,
					"error",
				);
				saveAssignmentsToLocalStorage(assignments);
				refreshAssignments();
			});
	});

	uploadButton.addEventListener("click", async () => {
		const selectedFile = fileInput.files?.[0];
		if (!selectedFile) {
			setStatus("Please select a WBS Excel file first.", "error");
			return;
		}

		setStatus(`Uploading ${selectedFile.name}...`);
		tableContainerEl.innerHTML =
			'<p class="text-sm text-gray-400 italic animate-pulse">Parsing file...</p>';

		try {
			const fileBuffer = await selectedFile.arrayBuffer();
			tableData = parseWorkbookToTableData(fileBuffer);
			selectedWbsRowIndex = null;
			wbsFilterValue = "";
			descriptionFilterValue = "";
			saveFileToLocalStorage(selectedFile, fileBuffer);
			refreshWbsTable();
			setStatus(
				`Loaded ${selectedFile.name} (${tableData.rows.length} rows). File saved locally.`,
			);
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "Failed to parse the selected Excel file.";
			setStatus("Upload failed.", "error");
			tableContainerEl.innerHTML = `<p class="text-sm text-red-600">${escapeHtml(message)}</p>`;
		}
	});
}
