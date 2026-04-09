import { escapeHtml } from "@imasd/shared";
import { read, utils } from "xlsx";

type WbsTableData = {
	headers: string[];
	rows: string[][];
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

function renderTable(tableData: WbsTableData): string {
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
				.map((row) => {
					const cells = row
						.map(
							(cell) =>
								`<td class="px-3 py-2 text-sm text-gray-800 border-b border-gray-100 align-top">${escapeHtml(cell)}</td>`,
						)
						.join("");
					return `<tr class="hover:bg-gray-50">${cells}</tr>`;
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

export function renderWbs(container: HTMLElement): void {
	container.innerHTML = `
    <h2 class="text-lg font-semibold">WBS</h2>
    <p class="mt-1 text-sm text-gray-500">Upload the WBS template and preview it as a table</p>

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

      <div data-wbs-table>
        <p class="text-sm text-gray-400 italic">Upload a WBS file to preview its data.</p>
      </div>
    </div>
  `;

	const fileInput = container.querySelector<HTMLInputElement>("#wbs-file");
	const uploadButton = container.querySelector<HTMLButtonElement>("[data-wbs-upload]");
	const status = container.querySelector<HTMLElement>("[data-wbs-status]");
	const tableContainer = container.querySelector<HTMLElement>("[data-wbs-table]");

	if (!fileInput || !uploadButton || !status || !tableContainer) {
		return;
	}

	uploadButton.addEventListener("click", async () => {
		const selectedFile = fileInput.files?.[0];
		if (!selectedFile) {
			status.textContent = "Please select a WBS Excel file first.";
			return;
		}

		status.textContent = `Uploading ${selectedFile.name}...`;
		tableContainer.innerHTML =
			'<p class="text-sm text-gray-400 italic animate-pulse">Parsing file...</p>';

		try {
			const fileBuffer = await selectedFile.arrayBuffer();
			const tableData = parseWorkbookToTableData(fileBuffer);
			tableContainer.innerHTML = renderTable(tableData);
			status.textContent = `Loaded ${selectedFile.name} (${tableData.rows.length} rows).`;
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
