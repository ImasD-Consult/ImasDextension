import { escapeHtml } from "@imasd/shared";
import type { WorkspaceApi } from "@imasd/shared/trimble";
import { read, utils } from "xlsx";

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
};

type WbsAssignment = {
	partId: string;
	partName: string;
	partType: string;
	partMaterial: string;
	wbsRowIndex: number;
	wbsValues: string[];
	propertySetName: "Pset_IMASD_WBS";
	assignedAt: string;
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
	// - Only columns A-E (index 0..4) are relevant
	const HEADER_ROW_INDEX = 2;
	const DATA_START_INDEX = 3;
	const MAX_COLUMNS = 5;

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

function getViewerPartsFallback(): IfcPart[] {
	return [
		{
			id: "part-001",
			name: "Wall Exterior A1",
			type: "IFCWALL",
			material: "Concrete",
		},
		{
			id: "part-002",
			name: "Column C-01",
			type: "IFCCOLUMN",
			material: "Concrete",
		},
		{
			id: "part-003",
			name: "Beam B-14",
			type: "IFCBEAM",
			material: "Steel",
		},
		{
			id: "part-004",
			name: "Slab S-02",
			type: "IFCSLAB",
			material: "Concrete",
		},
		{
			id: "part-005",
			name: "Door D-05",
			type: "IFCDOOR",
			material: "Wood",
		},
	];
}

async function loadIfcParts(api: WorkspaceApi): Promise<IfcPart[]> {
	// Current SDK typing in this repo only guarantees model-level access.
	// Keep a stable fallback so assignment workflow can be built now.
	const models = await api.viewer?.getModels?.();
	if (models && models.length > 0) {
		return models.map((model, index) => ({
			id: model.versionId || model.id || `model-${index + 1}`,
			name: model.name || `Model ${index + 1}`,
			type: "MODEL",
			material: "N/A",
		}));
	}
	return getViewerPartsFallback();
}

function renderTable(tableData: WbsTableData, selectedRowIndex: number | null): string {
	if (!tableData.headers.length) {
		return '<p class="text-sm text-gray-500 italic">No data found in the selected file.</p>';
	}

	const headerCells = tableData.headers
		.map(
			(header) =>
				`<th class="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 bg-gray-50 border-b border-gray-200">${escapeHtml(header)}</th>`,
		)
		.join("");

	const bodyRows = tableData.rows.length
		? tableData.rows
				.map((row, index) => {
					const isSelected = selectedRowIndex === index;
					const cells = row
						.map(
							(cell) =>
								`<td class="px-3 py-2 text-sm text-gray-800 border-b border-gray-100 align-top">${escapeHtml(cell)}</td>`,
						)
						.join("");
					return `<tr class="hover:bg-gray-50 ${isSelected ? "bg-brand-50 ring-1 ring-inset ring-brand-300" : ""}" data-wbs-row="${index}">${cells}</tr>`;
				})
				.join("")
		: `<tr><td class="px-3 py-3 text-sm text-gray-500 italic" colspan="${tableData.headers.length}">No rows found.</td></tr>`;

	return `
    <div class="rounded-lg border border-gray-200 overflow-hidden">
      <div class="max-h-[55vh] overflow-auto">
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

	return assignments
		.slice()
		.reverse()
		.map(
			(item) => `
      <div class="rounded border border-gray-200 px-3 py-2">
        <p class="text-sm font-medium text-gray-800">${escapeHtml(item.partName)}</p>
        <p class="text-xs text-gray-500">${escapeHtml(item.partType)} | ${escapeHtml(item.partMaterial)}</p>
        <p class="mt-1 text-xs text-gray-700">Pset: ${item.propertySetName} | WBS row ${item.wbsRowIndex + 4}</p>
      </div>
    `,
		)
		.join("");
}

export async function renderWbs(
	container: HTMLElement,
	api: WorkspaceApi,
): Promise<void> {
	container.innerHTML = `
    <h2 class="text-lg font-semibold">WBS</h2>
    <p class="mt-1 text-sm text-gray-500">Upload, preview, and assign WBS rows to IFC parts</p>

    <div class="mt-6 space-y-4">
      <div class="flex flex-wrap items-center gap-3">
        <input
          id="wbs-file"
          type="file"
          accept=".xlsx,.xls"
          class="block text-sm text-gray-700 file:mr-3 file:rounded file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-medium file:text-brand-700 hover:file:bg-brand-100"
        />
        <button
          type="button"
          class="rounded px-4 py-2 text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
          data-wbs-upload
        >
          Upload File
        </button>
      </div>

      <p class="text-xs text-gray-500">Expected file type: Excel template (.xlsx)</p>
      <p class="text-sm text-gray-600" data-wbs-status>No file uploaded yet.</p>

      <div class="grid grid-cols-12 gap-4">
        <div class="col-span-12 lg:col-span-4 rounded-lg border border-gray-200 p-3 space-y-3">
          <h3 class="text-sm font-semibold text-gray-700">IFC Parts (MVP)</h3>

          <div class="grid grid-cols-2 gap-2">
            <select class="rounded border border-gray-300 px-2 py-1 text-sm" data-type-filter>
              <option value="ALL">All Types</option>
            </select>
            <select class="rounded border border-gray-300 px-2 py-1 text-sm" data-material-filter>
              <option value="ALL">All Materials</option>
            </select>
          </div>

          <div class="max-h-[35vh] overflow-auto space-y-2" data-parts-list>
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

        <div class="col-span-12 lg:col-span-8" data-wbs-table>
          <p class="text-sm text-gray-400 italic">Upload a WBS file to preview and select a row.</p>
        </div>
      </div>

      <div class="rounded-lg border border-gray-200 p-3">
        <h3 class="text-sm font-semibold text-gray-700">Assigned Property Set Values (Pset_IMASD_WBS)</h3>
        <div class="mt-2 space-y-2 max-h-[24vh] overflow-auto" data-assignments-list>
          <p class="text-sm text-gray-400 italic">No assignments yet.</p>
        </div>
      </div>
    </div>
  `;

	const fileInput = container.querySelector<HTMLInputElement>("#wbs-file");
	const uploadButton = container.querySelector<HTMLButtonElement>("[data-wbs-upload]");
	const status = container.querySelector<HTMLElement>("[data-wbs-status]");
	const tableContainer = container.querySelector<HTMLElement>("[data-wbs-table]");
	const typeFilter = container.querySelector<HTMLSelectElement>("[data-type-filter]");
	const materialFilter = container.querySelector<HTMLSelectElement>(
		"[data-material-filter]",
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
		!partsList ||
		!assignButton ||
		!assignmentsList
	) {
		return;
	}

	const tableContainerEl = tableContainer;
	const typeFilterEl = typeFilter;
	const materialFilterEl = materialFilter;
	const partsListEl = partsList;
	const assignButtonEl = assignButton;
	const assignmentsListEl = assignmentsList;

	let tableData: WbsTableData = { headers: [], rows: [] };
	let selectedWbsRowIndex: number | null = null;
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
		partsListEl.innerHTML = renderPartsList(
			parts,
			selectedPartIds,
			typeFilterEl.value,
			materialFilterEl.value,
		);
		refreshAssignButton();
	}

	function refreshWbsTable(): void {
		tableContainerEl.innerHTML = renderTable(tableData, selectedWbsRowIndex);
		refreshAssignButton();
	}

	try {
		parts = await loadIfcParts(api);
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
		refreshPartsList();
	} catch {
		parts = getViewerPartsFallback();
		refreshPartsList();
	}

	refreshAssignments();

	const cachedFile = loadFileFromLocalStorage();
	if (cachedFile) {
		try {
			tableData = parseWorkbookToTableData(base64ToArrayBuffer(cachedFile.base64));
			refreshWbsTable();
			status.textContent = `Loaded ${cachedFile.name} from local storage (${tableData.rows.length} rows). Select a WBS row.`;
		} catch {
			status.textContent = "Stored WBS file is invalid. Please upload again.";
			localStorage.removeItem(WBS_STORAGE_KEY);
		}
	}

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

	assignButtonEl.addEventListener("click", () => {
		if (selectedWbsRowIndex === null) return;
		const assignedRowIndex = selectedWbsRowIndex;
		const selectedRow = tableData.rows[selectedWbsRowIndex];
		if (!selectedRow) return;

		const selectedParts = parts.filter((part) => selectedPartIds.has(part.id));
		const now = new Date().toISOString();

		selectedParts.forEach((part) => {
			assignments = assignments.filter((item) => item.partId !== part.id);
			assignments.push({
				partId: part.id,
				partName: part.name,
				partType: part.type,
				partMaterial: part.material,
				wbsRowIndex: assignedRowIndex,
				wbsValues: selectedRow,
				propertySetName: "Pset_IMASD_WBS",
				assignedAt: now,
			});
		});

		saveAssignmentsToLocalStorage(assignments);
		refreshAssignments();
		status.textContent = `Assigned WBS row ${assignedRowIndex + 4} to ${selectedParts.length} part(s).`;
	});

	uploadButton.addEventListener("click", async () => {
		const selectedFile = fileInput.files?.[0];
		if (!selectedFile) {
			status.textContent = "Please select a WBS Excel file first.";
			return;
		}

		status.textContent = `Uploading ${selectedFile.name}...`;
		tableContainerEl.innerHTML =
			'<p class="text-sm text-gray-400 italic animate-pulse">Parsing file...</p>';

		try {
			const fileBuffer = await selectedFile.arrayBuffer();
			tableData = parseWorkbookToTableData(fileBuffer);
			selectedWbsRowIndex = null;
			saveFileToLocalStorage(selectedFile, fileBuffer);
			refreshWbsTable();
			status.textContent = `Loaded ${selectedFile.name} (${tableData.rows.length} rows). File saved locally.`;
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "Failed to parse the selected Excel file.";
			status.textContent = "Upload failed.";
			tableContainer.innerHTML = `<p class="text-sm text-red-600">${escapeHtml(message)}</p>`;
		}
	});
}
