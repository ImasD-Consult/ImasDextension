import { escapeHtml } from "@imasd/shared";
import type { WorkspaceApi } from "@imasd/shared/trimble";
import { read, utils } from "xlsx";
import {
	fetchIfcAssembliesFromFile,
	fetchProjectIfcModels,
} from "../services/folders";
import { resolveViewerModelsForWbs } from "../services/viewer-model";
import {
	ensureWbsLibraryAndAssignmentsForLinks,
	fetchWbsPsetAssignmentsFromModel,
	inspectWbsPsetConfig,
	loadKnownLibraryLinks,
	verifyWbsValueByLink,
	writeWbsPropertySetValues,
	type WbsPsetModelAssignmentRow,
} from "../services/pset";

type WbsTableData = {
	headers: string[];
	rows: string[][];
};

const WBS_STORAGE_KEY = "smartprintpro:wbs:uploaded-file";
const WBS_ASSIGNMENTS_STORAGE_KEY = "smartprintpro:wbs:assignments";

type IfcPart = {
	id: string;
	name: string;
	type: string;
	material: string;
	modelId?: string;
	modelName?: string;
	link?: string;
	targetRuntimeId?: string;
	targetName?: string;
	resolvedViaParent?: boolean;
};

type WbsAssignment = {
	partId: string;
	modelId?: string;
	partName: string;
	partType: string;
	partMaterial: string;
	targetLink?: string;
	wbsRowIndex: number;
	wbsValues: string[];
	propertySetName: "Pset_IMASD_WBS";
	propertyName?: string;
	propertySetValue: string;
	assignedAt: string;
};

type IfcModelOption = {
	id: string;
	versionId?: string;
	name: string;
};

function isWritableLink(link: string | undefined): boolean {
	const l = link?.trim();
	if (!l) return false;
	return l.startsWith("frn:entity:");
}

function normalizeKnownLink(raw: string | undefined): string {
	const value = raw?.trim() ?? "";
	if (!value) return "";
	if (!value.startsWith("frn:entity:")) return value;
	const prefix = "frn:entity:";
	let entity = value.slice(prefix.length).trim();
	// Some sources return percent-encoded entity ids (e.g. %24 for '$').
	// Decode a couple of times defensively to match viewer/fileId forms.
	for (let i = 0; i < 2; i += 1) {
		try {
			const decoded = decodeURIComponent(entity);
			if (decoded === entity) break;
			entity = decoded;
		} catch {
			break;
		}
	}
	return `${prefix}${entity}`;
}

function getEntityIdFromFrn(link: string | undefined): string | undefined {
	const normalized = normalizeKnownLink(link);
	if (!normalized.startsWith("frn:entity:")) return undefined;
	const token = normalized.slice("frn:entity:".length).trim();
	return token || undefined;
}

function isValidRuntimeId(value: number): boolean {
	return Number.isFinite(value) && !Number.isNaN(value) && value > 0;
}

/** Normalize entity id / fileId for comparisons (encoding + case). */
function normalizeEntityIdToken(raw: string): string {
	let t = raw.trim();
	for (let i = 0; i < 2; i += 1) {
		try {
			const d = decodeURIComponent(t);
			if (d === t) break;
			t = d;
		} catch {
			break;
		}
	}
	return t.toLowerCase();
}

function entityIdTokensMatch(a: string, b: string): boolean {
	return normalizeEntityIdToken(a) === normalizeEntityIdToken(b);
}

function extractStableEntityLinkFromUnknownPayload(root: unknown): string | undefined {
	let foundFrnEntity: string | undefined;
	let foundStableId: string | undefined;
	const UUID_RE =
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	const IFC_COMPRESSED_GUID_RE = /^[0-9A-Za-z_$]{22}$/;
	const isLikelyStableEntityId = (value: string): boolean => {
		const v = value.trim();
		if (!v) return false;
		if (UUID_RE.test(v)) return true;
		if (IFC_COMPRESSED_GUID_RE.test(v)) return true;
		return false;
	};
	const guidKeys = new Set([
		"guid",
		"globalid",
		"ifcguid",
		"fileid",
		"entityid",
		"objectid",
	]);
	const walk = (node: unknown, depth: number): void => {
		if (depth > 18 || node == null) return;
		if (Array.isArray(node)) {
			for (const item of node) walk(item, depth + 1);
			return;
		}
		if (typeof node !== "object") return;
		const o = node as Record<string, unknown>;
		const nvName =
			typeof o.name === "string"
				? o.name.toLowerCase().trim()
				: typeof o.key === "string"
					? o.key.toLowerCase().trim()
					: undefined;
		const nvValue =
			typeof o.value === "string"
				? o.value.trim()
				: typeof o.val === "string"
					? o.val.trim()
					: undefined;
		if (nvName && nvValue && guidKeys.has(nvName) && isLikelyStableEntityId(nvValue)) {
			foundStableId = nvValue;
		}
		for (const [k, v] of Object.entries(o)) {
			if (typeof v === "string") {
				const sv = v.trim();
				const lk = k.toLowerCase();
				if (!sv) continue;
				if ((lk === "frn" || lk === "link") && sv.startsWith("frn:entity:")) {
					foundFrnEntity = sv;
				}
				if (guidKeys.has(lk) && isLikelyStableEntityId(sv)) {
					foundStableId = sv;
				}
			} else if (v && typeof v === "object") {
				walk(v, depth + 1);
			}
		}
	};
	walk(root, 0);
	if (foundFrnEntity) return normalizeKnownLink(foundFrnEntity);
	if (foundStableId) return `frn:entity:${foundStableId}`;
	return undefined;
}

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

function clearLocalWbsCache(): void {
	try {
		localStorage.removeItem(WBS_STORAGE_KEY);
		localStorage.removeItem(WBS_ASSIGNMENTS_STORAGE_KEY);
	} catch {
		/* ignore cache cleanup errors */
	}
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
): string {
	if (!parts.length) {
		return '<p class="text-sm text-gray-500 italic">No IFC objects selected yet. Use current 3D selection, then choose known link fallback if needed.</p>';
	}
	return parts
		.map((part) => {
			const hasStableLink = isWritableLink(part.link);
			const isSelected = selectedPartIds.has(part.id);
			return `
        <button
          type="button"
          data-part-id="${escapeHtml(part.id)}"
          class="w-full text-left flex items-center gap-2 rounded border px-2 py-2 ${isSelected ? "border-brand-500 bg-brand-50" : "border-gray-200"} ${hasStableLink ? "" : "opacity-70 bg-gray-50"}"
        >
          <span class="text-[10px] uppercase tracking-wide ${isSelected ? "text-brand-700" : "text-gray-500"}">${isSelected ? "Selected" : "Select"}</span>
          <span class="text-sm text-gray-800 min-w-0 flex-1 truncate" title="${escapeHtml(part.name)}">${escapeHtml(part.name)}</span>
          ${
						hasStableLink
							? '<span class="text-[10px] uppercase tracking-wide text-emerald-700">Ready</span>'
							: '<span class="text-[10px] uppercase tracking-wide text-red-600">No stable link</span>'
					}
          <span class="ml-auto text-xs text-gray-500">${escapeHtml(part.type)} | ${escapeHtml(part.material)}</span>
        </button>
      `;
		})
		.join("");
}

function renderAssignmentsList(
	assignments: WbsAssignment[],
	parts: IfcPart[],
	knownLinks: string[],
	selectedWbsRowIndex: number | null,
	activeModelScopeIds: string[],
): string {
	const scope = [...new Set(activeModelScopeIds.map((s) => s.trim()).filter(Boolean))];
	function assignmentMatchesCurrentModel(item: WbsAssignment): boolean {
		if (scope.length === 0) return true;
		const mid = item.modelId?.trim();
		if (!mid) return true;
		return scope.includes(mid);
	}
	const hasKnownPsetLinks = knownLinks.some((l) => Boolean(normalizeKnownLink(l)));
	if (!parts.length && !assignments.length && !hasKnownPsetLinks) {
		return '<p class="text-sm text-gray-500 italic">No IFC parts loaded for current model.</p>';
	}
	const latestByLink = new Map<string, WbsAssignment>();
	for (const item of assignments) {
		const link = normalizeKnownLink(item.targetLink);
		if (!link) continue;
		if (!latestByLink.has(link)) latestByLink.set(link, item);
	}
	const partByLink = new Map<string, IfcPart>();
	for (const part of parts) {
		const link = normalizeKnownLink(part.link);
		if (!link) continue;
		if (!partByLink.has(link)) partByLink.set(link, part);
	}
	const knownLinkSet = new Set(knownLinks.map((l) => normalizeKnownLink(l)).filter(Boolean));
	const usedKnownLinks = new Set<string>();
	const knownBySignature = new Map<string, string[]>();
	for (const item of assignments) {
		if (!assignmentMatchesCurrentModel(item)) continue;
		const link = normalizeKnownLink(item.targetLink);
		if (!link || !knownLinkSet.has(link)) continue;
		const sig = `${(item.partName ?? "").trim().toUpperCase()}::${(item.partType ?? "")
			.trim()
			.toUpperCase()}`;
		const bucket = knownBySignature.get(sig) ?? [];
		bucket.push(link);
		knownBySignature.set(sig, bucket);
	}
	type PartRowResolved = {
		part: IfcPart;
		directLink: string;
		mappedKnownLink: string | undefined;
		link: string;
	};
	const resolvedPartRows: PartRowResolved[] = [];
	for (const part of parts) {
		const directLink = normalizeKnownLink(part.link);
		const sig = `${(part.name ?? "").trim().toUpperCase()}::${(part.type ?? "")
			.trim()
			.toUpperCase()}`;
		const bySigBucket = knownBySignature.get(sig) ?? [];
		const mappedKnownLink =
			!directLink
				? bySigBucket.find((l) => !usedKnownLinks.has(l))
				: undefined;
		const link = directLink || mappedKnownLink || "";
		if (link && knownLinkSet.has(link)) usedKnownLinks.add(link);
		// Only list IFC rows that already have a writable stable link (direct or mapped).
		// Runtime-only rows were misleading (fake/table-order ids) and cluttered the table vs PSet targets.
		const actionable = isWritableLink(link);
		if (!actionable) continue;
		resolvedPartRows.push({ part, directLink, mappedKnownLink, link });
	}
	const rowsFromParts = resolvedPartRows
		.map(({ part, directLink, mappedKnownLink, link }) => {
			const latestRaw = link ? latestByLink.get(link) : undefined;
			const latest =
				latestRaw && assignmentMatchesCurrentModel(latestRaw) ? latestRaw : undefined;
			const staleOtherModel =
				Boolean(latestRaw) &&
				Boolean(link) &&
				!assignmentMatchesCurrentModel(latestRaw as WbsAssignment);
			const baseName = part.name || latest?.partName || latestRaw?.partName || "(unknown)";
			const className = part.type || latest?.partType || "(unknown)";
			const runtimeId = Number(part.id);
			const runtimeIdText = isValidRuntimeId(runtimeId) ? String(runtimeId) : "";
			const targetRuntimeIdNum = Number(part.targetRuntimeId?.trim() || runtimeIdText);
			const targetRuntimeIdRaw = isValidRuntimeId(targetRuntimeIdNum)
				? String(targetRuntimeIdNum)
				: "";
			const canHarvestFromRuntime = Boolean(targetRuntimeIdRaw);
			const targetName = part.targetName?.trim() || baseName;
			const displayName =
				part.resolvedViaParent && targetName !== baseName
					? `${baseName} (via ${targetName})`
					: baseName;
			const modelId = part.modelId?.trim() || latest?.modelId?.trim() || "";
			const guid = link.startsWith("frn:entity:") ? link.slice("frn:entity:".length) : "-";
			const modelLabel = part.modelName?.trim() || part.modelId?.trim() || latest?.modelId?.trim() || "-";
			const assignedValue = staleOtherModel
				? "(other IFC / cached)"
				: latest?.propertySetValue || "-";
			const assignedAt = staleOtherModel ? "-" : latest?.assignedAt || "-";
			const wbsRow =
				!staleOtherModel &&
				typeof latest?.wbsRowIndex === "number" &&
				latest.wbsRowIndex >= 0
					? String(latest.wbsRowIndex + 4)
					: "-";
			const isAssigned = Boolean(latest) && Boolean(link);
			const hasLink = Boolean(link);
			const statusBadge = staleOtherModel
				? '<span class="inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Other IFC</span>'
				: isAssigned
					? '<span class="inline-flex items-center rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Assigned</span>'
					: hasLink
						? !directLink && mappedKnownLink
							? '<span class="inline-flex items-center rounded bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">Mapped known target</span>'
							: part.resolvedViaParent
								? '<span class="inline-flex items-center rounded bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">Assigns to parent</span>'
								: '<span class="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">Never assigned</span>'
						: '<span class="inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">No link</span>';
			const canAssign = selectedWbsRowIndex !== null;
			const assignTitle = canAssign
				? "Assign selected WBS row to this target"
				: "Select a WBS row first";
			return `
      <tr class="hover:bg-gray-50">
        <td class="px-2 py-2 text-sm text-gray-800 border-b border-gray-100">${escapeHtml(displayName)}</td>
        <td class="px-2 py-2 text-xs text-gray-700 border-b border-gray-100">${escapeHtml(className)}</td>
        <td class="px-2 py-2 text-[11px] text-gray-700 border-b border-gray-100 max-w-[220px] truncate" title="${escapeHtml(guid)}">${escapeHtml(guid)}</td>
        <td class="px-2 py-2 text-[11px] text-gray-700 border-b border-gray-100 max-w-[220px] truncate" title="${escapeHtml(modelLabel)}">${escapeHtml(modelLabel)}</td>
        <td class="px-2 py-2 text-xs border-b border-gray-100">${statusBadge}</td>
        <td class="px-2 py-2 text-xs text-gray-800 border-b border-gray-100">${escapeHtml(assignedValue)}</td>
        <td class="px-2 py-2 text-xs text-gray-600 border-b border-gray-100">${escapeHtml(assignedAt)}</td>
        <td class="px-2 py-2 text-xs text-gray-600 border-b border-gray-100">${escapeHtml(wbsRow)}</td>
        <td class="px-2 py-2 text-[11px] text-gray-600 border-b border-gray-100 max-w-[260px] truncate" title="${escapeHtml(link || "(no link)")}">${escapeHtml(link || "(no link)")}</td>
        <td class="px-2 py-2 text-xs border-b border-gray-100 whitespace-nowrap">
          <button type="button" class="rounded border border-gray-300 px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50 mr-1 disabled:opacity-50 disabled:cursor-not-allowed" data-assignment-link="${escapeHtml(link || "")}" data-assignment-runtime-id="${escapeHtml(targetRuntimeIdRaw)}" data-assignment-model-id="${escapeHtml(modelId)}" data-assignment-part-id="${escapeHtml(part.id)}" ${(hasLink || canHarvestFromRuntime) ? "" : "disabled"}>Select in 3D</button>
          <button type="button" class="rounded border border-gray-300 px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50 mr-1" data-diagnose-part-id="${escapeHtml(part.id)}">Diagnose link</button>
          <button type="button" class="rounded border border-brand-600 px-2 py-0.5 font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50 disabled:cursor-not-allowed" data-assign-link="${escapeHtml(link || "")}" data-assign-runtime-id="${escapeHtml(targetRuntimeIdRaw)}" data-assign-model-id="${escapeHtml(modelId)}" data-assign-part-id="${escapeHtml(part.id)}" ${(canAssign && (hasLink || canHarvestFromRuntime)) ? "" : "disabled"} title="${escapeHtml(canAssign ? (hasLink ? assignTitle : (canHarvestFromRuntime ? "Will resolve link from runtime target before assign" : "Geometry only, no data properties found")) : "Select a WBS row first")}">Assign</button>
        </td>
      </tr>
    `;
		})
		.join("");
	const knownOnlyLinks = knownLinks
		.map((l) => normalizeKnownLink(l))
		.filter((link): link is string => Boolean(link))
		.filter((link) => !partByLink.has(link) && !usedKnownLinks.has(link));
	const rowsFromKnown = knownOnlyLinks
		.map((link, i) => {
			const latestRaw = latestByLink.get(link);
			const latest =
				latestRaw && assignmentMatchesCurrentModel(latestRaw) ? latestRaw : undefined;
			const staleOtherModel =
				Boolean(latestRaw) && !assignmentMatchesCurrentModel(latestRaw as WbsAssignment);
			const name = latest?.partName || latestRaw?.partName || `PSet target #${i + 1}`;
			const className = latest?.partType || latestRaw?.partType || "PSET";
			const guid = link.startsWith("frn:entity:") ? link.slice("frn:entity:".length) : "-";
			const modelLabel = latest?.modelId?.trim() || latestRaw?.modelId?.trim() || "-";
			const assignedValue = staleOtherModel
				? "(other IFC / cached)"
				: latest?.propertySetValue || "-";
			const assignedAt = staleOtherModel ? "-" : latest?.assignedAt || "-";
			const wbsRow =
				!staleOtherModel &&
				typeof latest?.wbsRowIndex === "number" &&
				latest.wbsRowIndex >= 0
					? String(latest.wbsRowIndex + 4)
					: "-";
			const isAssigned = Boolean(latest);
			const statusBadge = staleOtherModel
				? '<span class="inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Other IFC</span>'
				: isAssigned
					? '<span class="inline-flex items-center rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Assigned</span>'
					: '<span class="inline-flex items-center rounded bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">Known target</span>';
			const canAssign = selectedWbsRowIndex !== null;
			const assignTitle = canAssign
				? "Assign selected WBS row to this known target"
				: "Select a WBS row first";
			return `
      <tr class="hover:bg-gray-50 bg-sky-50/30">
        <td class="px-2 py-2 text-sm text-gray-800 border-b border-gray-100">${escapeHtml(name)}</td>
        <td class="px-2 py-2 text-xs text-gray-700 border-b border-gray-100">${escapeHtml(className)}</td>
        <td class="px-2 py-2 text-[11px] text-gray-700 border-b border-gray-100 max-w-[220px] truncate" title="${escapeHtml(guid)}">${escapeHtml(guid)}</td>
        <td class="px-2 py-2 text-[11px] text-gray-700 border-b border-gray-100 max-w-[220px] truncate" title="${escapeHtml(modelLabel)}">${escapeHtml(modelLabel)}</td>
        <td class="px-2 py-2 text-xs border-b border-gray-100">${statusBadge}</td>
        <td class="px-2 py-2 text-xs text-gray-800 border-b border-gray-100">${escapeHtml(assignedValue)}</td>
        <td class="px-2 py-2 text-xs text-gray-600 border-b border-gray-100">${escapeHtml(assignedAt)}</td>
        <td class="px-2 py-2 text-xs text-gray-600 border-b border-gray-100">${escapeHtml(wbsRow)}</td>
        <td class="px-2 py-2 text-[11px] text-gray-600 border-b border-gray-100 max-w-[260px] truncate" title="${escapeHtml(link)}">${escapeHtml(link)}</td>
        <td class="px-2 py-2 text-xs border-b border-gray-100 whitespace-nowrap">
          <button type="button" class="rounded border border-gray-300 px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50 mr-1" data-assignment-link="${escapeHtml(link)}" data-assignment-runtime-id="" data-assignment-model-id="" data-assignment-part-id="">Select in 3D</button>
          <button type="button" class="rounded border border-gray-300 px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50 mr-1 disabled:opacity-50 disabled:cursor-not-allowed" disabled>Diagnose link</button>
          <button type="button" class="rounded border border-brand-600 px-2 py-0.5 font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50 disabled:cursor-not-allowed" data-assign-link="${escapeHtml(link)}" data-assign-runtime-id="" data-assign-model-id="" data-assign-part-id="" ${canAssign ? "" : "disabled"} title="${escapeHtml(assignTitle)}">Assign</button>
        </td>
      </tr>
    `;
		})
		.join("");
	const rows = `${rowsFromParts}${rowsFromKnown}`;
	if (!rows.trim()) {
		return '<p class="text-sm text-gray-500 italic">No actionable targets: IFC rows with no link and no valid 3D runtime are hidden. Wait for known PSet links to load, or reload the model.</p>';
	}
	return `
    <div class="rounded border border-gray-200 overflow-hidden">
      <div class="max-h-[32vh] overflow-auto">
        <table class="min-w-full border-collapse">
          <thead class="sticky top-0 bg-gray-50 z-10">
            <tr>
              <th class="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 border-b border-gray-200">Name</th>
              <th class="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 border-b border-gray-200">Class</th>
              <th class="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 border-b border-gray-200">GUID</th>
              <th class="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 border-b border-gray-200">Model</th>
              <th class="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 border-b border-gray-200">Status</th>
              <th class="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 border-b border-gray-200">Last Assigned Value</th>
              <th class="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 border-b border-gray-200">Assigned At</th>
              <th class="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 border-b border-gray-200">WBS Row</th>
              <th class="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 border-b border-gray-200">Target Link</th>
              <th class="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 border-b border-gray-200">Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
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
	clearLocalWbsCache();
	const viewerOnly = options?.useViewerModelOnly === true;
	const dockLayout = viewerOnly && options?.horizontalDockLayout === true;

	if (dockLayout) {
		container.innerHTML = `
    <div class="flex flex-col h-full min-h-0 gap-2 text-gray-900" data-wbs-root>
      <div class="flex flex-wrap items-end gap-2 border-b border-gray-200 pb-2 shrink-0">
        <div class="flex flex-col min-w-0">
          <h2 class="text-base font-semibold leading-tight">WBS (v 6.26)</h2>
          <p class="text-xs text-gray-500">Excel (A–D) · IFC objects · Pset_IMASD_WBS</p>
        </div>
        <div class="flex flex-wrap items-center gap-2 flex-1 min-w-0 justify-end">
          <input type="hidden" data-viewer-model-id value="" />
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
          <span class="text-xs text-gray-600 truncate max-w-[min(56vw,280px)]" data-viewer-model-label title="">Open IFC (viewer)</span>
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
      <div class="shrink-0 flex flex-wrap items-center gap-2 rounded border border-gray-200 bg-gray-50 p-2">
        <p class="text-[11px] text-gray-500 truncate max-w-[520px]" data-known-link-hint>
          Known targets load automatically for the current model.
        </p>
        <button
          type="button"
          class="hidden rounded px-3 py-1 text-xs font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          data-assign
          disabled
        >
          Assign selected objects to selected WBS row
        </button>
        <p class="text-[11px] text-gray-500">Writes Pset_IMASD_WBS on the open IFC.</p>
      </div>
      <div class="flex-1 flex flex-col min-h-0 gap-2 overflow-hidden">
        <div class="flex flex-col min-h-0 rounded-lg border border-gray-200 bg-white overflow-hidden shrink-0 max-h-[min(44vh,520px)]">
          <div class="px-2 py-1.5 bg-gray-100 border-b border-gray-200 flex items-center justify-between gap-2 shrink-0">
            <span class="text-xs font-semibold text-gray-700">WBS (Excel)</span>
            <span class="text-xs text-gray-500">Header row 3 · columns A–D</span>
          </div>
          <div class="flex-1 min-h-0 flex flex-col p-2 overflow-hidden" data-wbs-table>
            <p class="text-sm text-gray-400 italic">Upload a WBS file to preview and select a row.</p>
          </div>
        </div>
        <div class="hidden flex-1 flex flex-col min-h-0 rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div class="px-2 py-1.5 bg-gray-100 border-b border-gray-200 shrink-0">
            <span class="text-xs font-semibold text-gray-700">IFC objects</span>
            <p class="text-xs text-gray-500 mt-0.5" data-viewer-hint>From the model open in 3D (not the project folder).</p>
          </div>
          <div class="px-2 pt-2 shrink-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-600">Filter by type</label>
              <select class="w-full rounded border border-gray-300 px-2 py-1 text-sm" data-type-filter>
                <option value="ALL">All Types</option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-600">Filter by material</label>
              <select class="w-full rounded border border-gray-300 px-2 py-1 text-sm" data-material-filter>
                <option value="ALL">All Materials</option>
              </select>
            </div>
          </div>
          <div class="px-2 pt-1 flex items-center justify-between gap-2 shrink-0">
            <p class="text-xs text-gray-500" data-assembly-last-checked>Last checked: -</p>
          </div>
          <div class="flex-1 min-h-0 overflow-auto px-2 pb-2 space-y-2 select-none" data-parts-list>
            <p class="text-sm text-gray-400 italic">Loading parts...</p>
          </div>
        </div>
      </div>

      <div class="flex-1 min-h-0 rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div class="px-2 py-1.5 bg-gray-100 border-b border-gray-200">
          <span class="text-xs font-semibold text-gray-700">Known targets and assignments</span>
        </div>
        <div class="h-full overflow-auto p-2" data-assignments-list>
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
          <h2 class="text-lg font-semibold">WBS (v 6.26)</h2>
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
          ${
						viewerOnly
							? `
          <input type="hidden" data-viewer-model-id value="" />
          <div>
            <p class="text-xs font-medium text-gray-700">Open IFC</p>
            <p class="text-xs text-gray-600 truncate" data-viewer-model-label title="">Detecting…</p>
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
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-600">Filter by type</label>
              <select class="w-full rounded border border-gray-300 px-2 py-1 text-sm" data-type-filter>
                <option value="ALL">All Types</option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-600">Filter by material</label>
              <select class="w-full rounded border border-gray-300 px-2 py-1 text-sm" data-material-filter>
                <option value="ALL">All Materials</option>
              </select>
            </div>
          </div>
          `
							: `
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-600">IFC Model</label>
            <select class="w-full rounded border border-gray-300 px-2 py-1 text-sm" data-model-filter>
              <option value="">Select IFC model</option>
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
          `
					}

          <div class="max-h-[52vh] overflow-auto space-y-2 select-none" data-parts-list>
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
	const viewerModelLabel = container.querySelector<HTMLElement>(
		"[data-viewer-model-label]",
	);
	const retryAssembliesButton = container.querySelector<HTMLButtonElement>(
		"[data-retry-assemblies]",
	);
	const psetDebugCheckButton = container.querySelector<HTMLButtonElement>(
		"[data-pset-debug-check]",
	);
	const loadKnownLinksButton = container.querySelector<HTMLButtonElement>(
		"[data-load-known-links]",
	);
	const knownLinkSelect = container.querySelector<HTMLSelectElement>(
		"[data-known-link-select]",
	);
	const knownLinkHint = container.querySelector<HTMLElement>(
		"[data-known-link-hint]",
	);
	const resolveLinksButton = container.querySelector<HTMLButtonElement>(
		"[data-resolve-links]",
	);
	const psetDebugLabel = container.querySelector<HTMLElement>("[data-pset-debug]");
	const modelPsetCheckButton = container.querySelector<HTMLButtonElement>(
		"[data-model-pset-check]",
	);
	const modelPsetDebugLabel = container.querySelector<HTMLElement>(
		"[data-model-pset-debug]",
	);
	const useViewerSelectionButton = container.querySelector<HTMLButtonElement>(
		"[data-use-viewer-selection]",
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
		!materialFilter ||
		!retryAssembliesButton ||
		!lastCheckedLabel ||
		!partsList ||
		!assignButton ||
		!assignmentsList
	) {
		return;
	}
	if (!typeFilter || (!viewerOnly && (!modelFilter || !modelSearch))) {
		return;
	}

	const tableContainerEl = tableContainer;
	const statusEl = status;
	const typeFilterEl = typeFilter;
	const materialFilterEl = materialFilter;
	const modelFilterEl = modelFilter;
	const modelSearchEl = modelSearch as HTMLInputElement | null;
	const viewerModelLabelEl = viewerModelLabel;
	const retryAssembliesButtonEl = retryAssembliesButton;
	const psetDebugCheckButtonEl = psetDebugCheckButton;
	const loadKnownLinksButtonEl = loadKnownLinksButton;
	const knownLinkSelectEl = knownLinkSelect;
	const knownLinkHintEl = knownLinkHint;
	const resolveLinksButtonEl = resolveLinksButton;
	const psetDebugLabelEl = psetDebugLabel;
	const modelPsetCheckButtonEl = modelPsetCheckButton;
	const modelPsetDebugLabelEl = modelPsetDebugLabel;
	const useViewerSelectionButtonEl = useViewerSelectionButton;
	const lastCheckedLabelEl = lastCheckedLabel;
	const partsListEl = partsList;
	const assignButtonEl = assignButton;
	const assignmentsListEl = assignmentsList;

	function getActiveModelId(): string {
		if (viewerOnly) {
			const first = container.querySelector<HTMLInputElement>(
				"[data-viewer-model-id]",
			);
			return first?.value ?? "";
		}
		return modelFilterEl?.value ?? "";
	}

	function setViewerModelUi(model: IfcModelOption): void {
		container
			.querySelectorAll<HTMLInputElement>("[data-viewer-model-id]")
			.forEach((el) => {
				el.value = model.id;
			});
		if (viewerModelLabelEl) {
			viewerModelLabelEl.textContent = model.name;
			viewerModelLabelEl.title = model.name;
		}
	}

	async function syncViewerSelection(): Promise<void> {
		const v = api.viewer;
		if (!viewerOnly || !v?.setSelection) return;
		const modelId = getActiveModelId();
		if (!modelId) return;
		const runtimeIds = getAssignableParts()
			.filter((p) => selectedPartIds.has(p.id))
			.map((p) => Number(p.id))
			.filter((n) => isValidRuntimeId(n));
		// Avoid setSelection with an empty list — some hosts treat it like "all" or reset badly.
		if (runtimeIds.length === 0) return;
		try {
			await v.setSelection(
				{
					modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }],
				},
				"set",
			);
		} catch {
			/* optional — host may reject */
		}
	}

	function setStatus(
		message: string,
		tone: "info" | "error" = "info",
	): void {
		statusEl.textContent = message;
		statusEl.classList.remove("text-gray-600", "text-red-600");
		statusEl.classList.add(tone === "error" ? "text-red-600" : "text-gray-600");
	}

	async function refreshPsetDebugInfo(): Promise<void> {
		if (!psetDebugLabelEl) return;
		psetDebugLabelEl.textContent = "PSet debug: checking...";
		psetDebugLabelEl.classList.remove("text-red-600", "text-emerald-700", "text-gray-500");
		psetDebugLabelEl.classList.add("text-gray-500");
		try {
			const diag = await inspectWbsPsetConfig(api);
			if (diag.ok) {
				const defs =
					diag.availableDefinitions && diag.availableDefinitions.length
						? ` | defs: ${diag.availableDefinitions.join(" ; ")}`
						: "";
				const propName = diag.resolvedPropertyLabel ?? diag.resolvedPropertyName ?? "(unknown)";
				psetDebugLabelEl.textContent =
					`PSet OK | lib "${diag.resolvedLibName ?? "(no name)"}" | def "${diag.resolvedDefName ?? "(no name)"}" | property "${propName}"${defs}`;
				psetDebugLabelEl.classList.remove("text-gray-500", "text-red-600");
				psetDebugLabelEl.classList.add("text-emerald-700");
			} else {
				const defs =
					diag.availableDefinitions && diag.availableDefinitions.length
						? ` | defs: ${diag.availableDefinitions.join(" ; ")}`
						: "";
				psetDebugLabelEl.textContent =
					`PSet ERR | ${diag.message} | service ${diag.serviceUri || "(n/a)"} | configured definition "${diag.configuredDefinitionName || "(n/a)"}" | configured property "${diag.configuredPropertyName || "(n/a)"}" | resolved library "${diag.resolvedLibName ?? "(unknown)"}"${defs}`;
				psetDebugLabelEl.classList.remove("text-gray-500", "text-emerald-700");
				psetDebugLabelEl.classList.add("text-red-600");
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			psetDebugLabelEl.textContent = `PSet ERR | ${message}`;
			psetDebugLabelEl.classList.remove("text-gray-500", "text-emerald-700");
			psetDebugLabelEl.classList.add("text-red-600");
		}
	}

	function summarizeModelPropertySets(
		root: unknown,
	): Array<{ psetName: string; props: Array<{ key: string; value: string }> }> {
		const out = new Map<string, Map<string, string>>();
		const scalar = (v: unknown): string | null => {
			if (typeof v === "string") return v.trim();
			if (typeof v === "number" || typeof v === "boolean") return String(v);
			return null;
		};
		const add = (psetName: string, key: string, value: string): void => {
			const p = psetName.trim();
			const k = key.trim();
			const v = value.trim();
			if (!p || !k || !v) return;
			if (!out.has(p)) out.set(p, new Map<string, string>());
			const props = out.get(p)!;
			if (!props.has(k)) props.set(k, v);
		};
		const maybeGroupName = (
			node: Record<string, unknown>,
			activePset?: string,
		): string | undefined => {
			const ownName =
				(typeof node.name === "string" && node.name.trim()) ||
				(typeof node.displayName === "string" && node.displayName.trim()) ||
				(typeof node.propertySetName === "string" && node.propertySetName.trim()) ||
				(typeof node.groupName === "string" && node.groupName.trim()) ||
				undefined;
			if (ownName) return ownName;
			return activePset;
		};
		const walk = (node: unknown, depth: number, activePset?: string): void => {
			if (depth > 16 || node == null) return;
			if (Array.isArray(node)) {
				for (const item of node) walk(item, depth + 1, activePset);
				return;
			}
			if (typeof node !== "object") return;
			const o = node as Record<string, unknown>;
			const nextPset = maybeGroupName(o, activePset);

			const keyCandidate =
				(typeof o.name === "string" && o.name.trim()) ||
				(typeof o.displayName === "string" && o.displayName.trim()) ||
				(typeof o.propertyName === "string" && o.propertyName.trim()) ||
				(typeof o.key === "string" && o.key.trim()) ||
				undefined;
			const valCandidate =
				scalar(o.value) ??
				scalar(o.stringValue) ??
				scalar(o.displayValue) ??
				scalar(o.nominalValue);
			if (nextPset && keyCandidate && valCandidate) {
				add(nextPset, keyCandidate, valCandidate);
			}

			// Common TC structure: { name: "Pset...", properties: [{ name, value }, ...] }
			const nestedProps = o.properties;
			if (Array.isArray(nestedProps) && nextPset) {
				for (const item of nestedProps) {
					if (!item || typeof item !== "object") continue;
					const ip = item as Record<string, unknown>;
					const nk =
						(typeof ip.name === "string" && ip.name.trim()) ||
						(typeof ip.displayName === "string" && ip.displayName.trim()) ||
						(typeof ip.propertyName === "string" && ip.propertyName.trim()) ||
						(typeof ip.key === "string" && ip.key.trim()) ||
						undefined;
					const nv =
						scalar(ip.value) ??
						scalar(ip.stringValue) ??
						scalar(ip.displayValue) ??
						scalar(ip.nominalValue);
					if (nk && nv) add(nextPset, nk, nv);
				}
			}
			// Also support map/object style: { props: { key: value } }
			const mapProps = o.props;
			if (mapProps && typeof mapProps === "object" && !Array.isArray(mapProps) && nextPset) {
				for (const [k, v] of Object.entries(mapProps as Record<string, unknown>)) {
					const sv = scalar(v);
					if (sv) add(nextPset, k, sv);
				}
			}

			for (const [k, v] of Object.entries(o)) {
				const sv = scalar(v);
				if (nextPset && sv && !["name", "displayName"].includes(k)) {
					add(nextPset, k, sv);
				}
				if (v && typeof v === "object") walk(v, depth + 1, nextPset);
			}
		};
		walk(root, 0, undefined);
		if (out.size === 0 && root && typeof root === "object") {
			// Last-resort fallback to expose something debuggable from payload.
			const flat = root as Record<string, unknown>;
			for (const [k, v] of Object.entries(flat)) {
				const sv = scalar(v);
				if (sv) add("root", k, sv);
			}
		}
		return [...out.entries()].map(([psetName, propsMap]) => ({
			psetName,
			props: [...propsMap.entries()].map(([key, value]) => ({ key, value })),
		}));
	}

	async function refreshModelPsetDebugInfo(): Promise<void> {
		if (!modelPsetDebugLabelEl) return;
		modelPsetDebugLabelEl.textContent = "Model Psets: checking...";
		modelPsetDebugLabelEl.classList.remove("text-red-600", "text-emerald-700", "text-gray-500");
		modelPsetDebugLabelEl.classList.add("text-gray-500");
		const viewer = api.viewer;
		const selected = getAssignableParts().filter((p) => selectedPartIds.has(p.id));
		const first = selected[0];
		if (!first) {
			modelPsetDebugLabelEl.textContent = "Model Psets: select one object first.";
			return;
		}
		if (!viewer?.getObjectProperties) {
			modelPsetDebugLabelEl.textContent = "Model Psets: getObjectProperties API unavailable.";
			modelPsetDebugLabelEl.classList.remove("text-gray-500");
			modelPsetDebugLabelEl.classList.add("text-red-600");
			return;
		}
		const rid = Number(first.id);
		if (Number.isNaN(rid)) {
			modelPsetDebugLabelEl.textContent = "Model Psets: selected object has non-numeric runtime id.";
			modelPsetDebugLabelEl.classList.remove("text-gray-500");
			modelPsetDebugLabelEl.classList.add("text-red-600");
			return;
		}
		const activeModelId = getActiveModelId();
		const openModel = allIfcModels.find(
			(m) => activeModelId === m.id || activeModelId === m.versionId,
		);
		const modelCandidates = [openModel?.id, openModel?.versionId, activeModelId].filter(
			(v): v is string => typeof v === "string" && v.trim().length > 0,
		);
		for (const modelId of modelCandidates) {
			try {
				const props = await viewer.getObjectProperties(modelId, [rid]);
				const firstPayload = Array.isArray(props) ? props[0] : undefined;
				const psets = summarizeModelPropertySets(firstPayload);
				if (psets.length === 0) continue;
				const text = psets
					.slice(0, 6)
					.map((p) => {
						const inner = p.props
							.slice(0, 6)
							.map((kv) => `${kv.key}=${kv.value}`)
							.join(", ");
						return `${p.psetName}[${inner}]`;
					})
					.join(" | ");
				modelPsetDebugLabelEl.textContent = `Model Psets OK: ${text}`;
				modelPsetDebugLabelEl.classList.remove("text-gray-500", "text-red-600");
				modelPsetDebugLabelEl.classList.add("text-emerald-700");
				return;
			} catch {
				/* try next model candidate */
			}
		}
		let fallbackMessage:
			| "Model Psets: no property sets were parsed from selected object payload."
			| string =
			"Model Psets: no property sets were parsed from selected object payload.";
		try {
			const probeModelId = modelCandidates[0];
			if (probeModelId) {
				const props = await viewer.getObjectProperties(probeModelId, [rid]);
				const firstPayload = Array.isArray(props) ? props[0] : undefined;
				const topKeys =
					firstPayload && typeof firstPayload === "object"
						? Object.keys(firstPayload as Record<string, unknown>).slice(0, 20)
						: [];
				if (topKeys.length > 0) {
					fallbackMessage = `Model Psets: parsed none. Top-level payload keys: ${topKeys.join(", ")}`;
				} else {
					fallbackMessage =
						"Model Psets: parsed none and payload shape is empty/unknown.";
				}
			}
		} catch {
			/* ignore probe */
		}
		modelPsetDebugLabelEl.textContent = fallbackMessage;
		modelPsetDebugLabelEl.classList.remove("text-gray-500", "text-emerald-700");
		modelPsetDebugLabelEl.classList.add("text-red-600");
	}

	let tableData: WbsTableData = { headers: [], rows: [] };
	let selectedWbsRowIndex: number | null = null;
	let wbsFilterValue = "";
	let descriptionFilterValue = "";
	let allIfcModels: IfcModelOption[] = [];
	const partsByModelId = new Map<string, IfcPart[]>();
	let parts: IfcPart[] = [];
	const selectedPartIds = new Set<string>();
	let assignments: WbsAssignment[] = [];
	let assignmentsModelId = "";
	const parentByRuntimeId = new Map<number, number | null>();
	const fileIdByRuntimeId = new Map<number, string>();
	const nameByRuntimeId = new Map<number, string>();
	let hierarchyCacheModelId = "";
	let knownLibraryLinks: string[] = [];
	const ensuredLibraryModelIds = new Set<string>();
	/** Stable `frn:entity:*` → viewer runtime for highlights (rebuilt per model load). */
	const entityLinkToRuntimeCache = new Map<
		string,
		{ modelId: string; runtimeId: number }
	>();

	function refreshKnownLinkOptions(): void {
		if (!knownLinkSelectEl) return;
		knownLinkSelectEl.innerHTML =
			'<option value="">Known link target (required for Assign)</option>' +
			knownLibraryLinks
				.map((l, i) => {
					const suffix = l.length > 56 ? `${l.slice(0, 28)}...${l.slice(-22)}` : l;
					return `<option value="${escapeHtml(l)}">#${i + 1} ${escapeHtml(suffix)}</option>`;
				})
				.join("");
	}

	function refreshKnownLinkHint(): void {
		if (!knownLinkHintEl) return;
		const selected = knownLinkSelectEl?.value?.trim();
		knownLinkHintEl.textContent = selected
			? `Known link fallback selected: ${selected}`
			: `Known targets loaded: ${knownLibraryLinks.length}`;
	}

	function getAssignableParts(): IfcPart[] {
		return parts;
	}

	function refreshAssignments(): void {
		const active = getActiveModelId();
		const open = allIfcModels.find(
			(m) => active && (m.id === active || m.versionId === active),
		);
		const modelScope = [active, open?.versionId, open?.id].filter(
			(x): x is string => typeof x === "string" && x.trim().length > 0,
		);
		assignmentsListEl.innerHTML = renderAssignmentsList(
			assignments,
			getAssignableParts(),
			knownLibraryLinks,
			selectedWbsRowIndex,
			modelScope,
		);
	}

	function refreshAssignButton(): void {
		const hasKnownFallback = Boolean(knownLinkSelectEl?.value?.trim());
		assignButtonEl.disabled =
			selectedWbsRowIndex === null ||
			!hasKnownFallback ||
			!tableData.rows.length;
	}

	async function runWithButtonFeedback(
		button: HTMLButtonElement,
		busyText: string,
		task: () => Promise<void>,
	): Promise<void> {
		const prevText = button.textContent ?? "";
		const prevDisabled = button.disabled;
		button.disabled = true;
		button.classList.add("bg-brand-800", "ring-2", "ring-brand-300");
		button.textContent = busyText;
		try {
			await task();
		} finally {
			button.textContent = prevText;
			button.classList.remove("bg-brand-800", "ring-2", "ring-brand-300");
			button.disabled = prevDisabled;
		}
	}

	function countReadyParts(source: IfcPart[]): number {
		return source.filter((p) => isWritableLink(p.link)).length;
	}

	async function resolveStableLinksForParts(input: IfcPart[]): Promise<IfcPart[]> {
		if (input.length === 0) return input;

		const viewer = api.viewer as WorkspaceApi["viewer"] & {
			getObjects?: (
				selector?: {
					modelObjectIds?: Array<{
						modelId: string;
						objectRuntimeIds?: number[];
					}>;
				},
				objectState?: Record<string, unknown>,
			) => Promise<Array<{ modelId?: string; objects?: unknown }>>;
		};
		if (!viewer?.getObjectProperties) return input;

		const activeModelId = getActiveModelId();
		const openModel = allIfcModels.find(
			(m) => activeModelId === m.id || activeModelId === m.versionId,
		);
		const modelCandidates = [openModel?.id, openModel?.versionId, activeModelId].filter(
			(v): v is string => typeof v === "string" && v.trim().length > 0,
		);
		if (modelCandidates.length === 0) return input;

		const runtimeIds = input
			.map((part) => Number(part.id))
			.filter((n) => !Number.isNaN(n));
		if (runtimeIds.length === 0) return input;

		const stableByRuntime = new Map<number, string>();
		const UUID_RE =
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
		const IFC_COMPRESSED_GUID_RE = /^[0-9A-Za-z_$]{22}$/;
		const isLikelyStableEntityId = (value: string): boolean => {
			const v = value.trim();
			if (!v) return false;
			if (UUID_RE.test(v)) return true;
			if (IFC_COMPRESSED_GUID_RE.test(v)) return true;
			return false;
		};
		const extractStableEntityLinkFromPayload = (
			root: unknown,
		): string | undefined => {
			let foundFrnEntity: string | undefined;
			let foundStableId: string | undefined;
			const guidKeys = new Set([
				"guid",
				"globalid",
				"ifcguid",
				"fileid",
				"entityid",
				"objectid",
			]);
			const walk = (node: unknown, depth: number): void => {
				if (depth > 18 || node == null) return;
				if (Array.isArray(node)) {
					for (const item of node) walk(item, depth + 1);
					return;
				}
				if (typeof node !== "object") return;
				const o = node as Record<string, unknown>;
				const nvName =
					typeof o.name === "string"
						? o.name.toLowerCase().trim()
						: typeof o.key === "string"
							? o.key.toLowerCase().trim()
							: undefined;
				const nvValue =
					typeof o.value === "string"
						? o.value.trim()
						: typeof o.val === "string"
							? o.val.trim()
							: undefined;
				if (nvName && nvValue && guidKeys.has(nvName) && isLikelyStableEntityId(nvValue)) {
					foundStableId = nvValue;
				}
				for (const [k, v] of Object.entries(o)) {
					if (typeof v === "string") {
						const sv = v.trim();
						if (!sv) continue;
						if (
							(k.toLowerCase() === "frn" || k.toLowerCase() === "link") &&
							sv.startsWith("frn:entity:")
						) {
							foundFrnEntity = sv;
						}
						if (
							guidKeys.has(k.toLowerCase()) &&
							isLikelyStableEntityId(sv)
						) {
							foundStableId = sv;
						}
					} else if (v && typeof v === "object") {
						walk(v, depth + 1);
					}
				}
			};
			walk(root, 0);
			if (foundFrnEntity) return foundFrnEntity;
			if (foundStableId) return `frn:entity:${foundStableId}`;
			return undefined;
		};
		for (const modelId of modelCandidates) {
			try {
				const props = await viewer.getObjectProperties(modelId, runtimeIds);
				if (!Array.isArray(props)) continue;
				for (let i = 0; i < runtimeIds.length; i++) {
					if (stableByRuntime.has(runtimeIds[i])) continue;
					const p = props[i];
					if (!p || typeof p !== "object") continue;
					const po = p as Record<string, unknown>;
					const ridRaw = po.id;
					const rid =
						typeof ridRaw === "number" && !Number.isNaN(ridRaw)
							? ridRaw
							: runtimeIds[i];
					const frn =
						typeof po.frn === "string" && po.frn.trim().startsWith("frn:entity:")
							? po.frn.trim()
							: undefined;
					const candidateStableId =
						typeof po.fileId === "string" && po.fileId.trim()
							? po.fileId.trim()
							: typeof po.entityId === "string" && po.entityId.trim()
								? po.entityId.trim()
								: typeof po.guid === "string" && po.guid.trim()
									? po.guid.trim()
									: typeof po.globalId === "string" && po.globalId.trim()
										? po.globalId.trim()
										: undefined;
					if (frn) {
						stableByRuntime.set(rid, frn);
					} else if (candidateStableId && isLikelyStableEntityId(candidateStableId)) {
						// Safe fallback: only accept UUID-like stable ids (avoid runtime numeric ids).
						stableByRuntime.set(rid, `frn:entity:${candidateStableId}`);
					} else {
						const deep = extractStableEntityLinkFromPayload(p);
						if (deep) stableByRuntime.set(rid, deep);
					}
				}
			} catch {
				/* try next model candidate */
			}
		}

		if (stableByRuntime.size === 0) return input;
		const unresolvedRuntimeIds = runtimeIds.filter((rid) => !stableByRuntime.has(rid));
		if (unresolvedRuntimeIds.length > 0 && typeof viewer?.getObjects === "function") {
			for (const modelId of modelCandidates) {
				try {
					const rows = await viewer.getObjects({
						modelObjectIds: [
							{
								modelId,
								objectRuntimeIds: unresolvedRuntimeIds,
							},
						],
					});
					for (const row of rows ?? []) {
						const objects = row?.objects;
						if (!Array.isArray(objects)) continue;
						for (const item of objects) {
							if (!item || typeof item !== "object") continue;
							const o = item as Record<string, unknown>;
							const rid =
								typeof o.objectRuntimeId === "number"
									? o.objectRuntimeId
									: typeof o.id === "number"
										? o.id
										: typeof o.runtimeId === "number"
											? o.runtimeId
											: null;
							if (rid == null || stableByRuntime.has(rid)) continue;
							const frn =
								typeof o.frn === "string" && o.frn.trim().startsWith("frn:entity:")
									? o.frn.trim()
									: typeof o.link === "string" && o.link.trim().startsWith("frn:entity:")
										? o.link.trim()
										: undefined;
							const stableId =
								typeof o.fileId === "string" && o.fileId.trim()
									? o.fileId.trim()
									: typeof o.entityId === "string" && o.entityId.trim()
										? o.entityId.trim()
										: typeof o.guid === "string" && o.guid.trim()
											? o.guid.trim()
											: typeof o.globalId === "string" && o.globalId.trim()
												? o.globalId.trim()
												: undefined;
							if (frn) {
								stableByRuntime.set(rid, frn);
							} else if (stableId && isLikelyStableEntityId(stableId)) {
								stableByRuntime.set(rid, `frn:entity:${stableId}`);
							}
						}
					}
				} catch {
					/* try next model candidate */
				}
			}
		}
		if (stableByRuntime.size === 0) return input;
		return input.map((part) => {
			const rid = Number(part.id);
			if (Number.isNaN(rid)) return part;
			const stable = stableByRuntime.get(rid);
			return stable
				? {
						...part,
						link: stable,
						targetRuntimeId: part.targetRuntimeId?.trim() || part.id,
						targetName: part.targetName?.trim() || part.name,
						resolvedViaParent: part.resolvedViaParent ?? false,
				  }
				: part;
		});
	}

	async function hydratePartsFromViewerObjectRegistry(
		input: IfcPart[],
	): Promise<IfcPart[]> {
		if (!input.length) return input;
		const viewer = api.viewer as WorkspaceApi["viewer"] & {
			getObjects?: (
				selector?: {
					modelObjectIds?: Array<{
						modelId: string;
						objectRuntimeIds?: number[];
					}>;
				},
			) => Promise<Array<{ modelId?: string; objects?: unknown }>>;
		};
		if (typeof viewer?.getObjects !== "function") return input;
		const modelId = getActiveModelId();
		if (!modelId) return input;

		type ObjRow = { rid: number; name: string; cls: string; link?: string };
		const rows: ObjRow[] = [];
		try {
			// Host compatibility: selector-based getObjects can return empty in some environments.
			// Use full getObjects() and filter by model id locally.
			const modelRows = await viewer.getObjects();
			for (const row of modelRows ?? []) {
				const rowModelId = typeof row?.modelId === "string" ? row.modelId : "";
				if (rowModelId && rowModelId !== modelId) continue;
				const objects = row?.objects;
				if (!Array.isArray(objects)) continue;
				for (const item of objects) {
					if (!item || typeof item !== "object") continue;
					const o = item as Record<string, unknown>;
					const rid =
						typeof o.objectRuntimeId === "number"
							? o.objectRuntimeId
							: typeof o.id === "number"
								? o.id
								: typeof o.runtimeId === "number"
									? o.runtimeId
									: NaN;
					if (!isValidRuntimeId(rid)) continue;
					const name =
						typeof o.name === "string"
							? o.name.trim()
							: typeof o.displayName === "string"
								? o.displayName.trim()
								: "";
					const cls =
						typeof o.class === "string"
							? o.class.trim().toUpperCase()
							: typeof o.type === "string"
								? o.type.trim().toUpperCase()
								: "";
					const linkDirect =
						typeof o.frn === "string" && o.frn.trim().startsWith("frn:entity:")
							? o.frn.trim()
							: typeof o.link === "string" && o.link.trim().startsWith("frn:entity:")
								? o.link.trim()
								: undefined;
					const stableId =
						typeof o.fileId === "string" && o.fileId.trim()
							? o.fileId.trim()
							: typeof o.globalId === "string" && o.globalId.trim()
								? o.globalId.trim()
								: typeof o.guid === "string" && o.guid.trim()
									? o.guid.trim()
									: undefined;
					const link = linkDirect ?? (stableId ? `frn:entity:${stableId}` : undefined);
					rows.push({ rid, name, cls, link });
				}
			}
		} catch {
			return input;
		}
		if (!rows.length) return input;

		const bySignature = new Map<string, ObjRow[]>();
		for (const r of rows) {
			const key = `${r.name}::${r.cls}`;
			const bucket = bySignature.get(key) ?? [];
			bucket.push(r);
			bySignature.set(key, bucket);
		}
		const used = new Set<number>();
		return input.map((part) => {
			const key = `${(part.name ?? "").trim()}::${(part.type ?? "").trim().toUpperCase()}`;
			const bucket = bySignature.get(key) ?? [];
			const candidate = bucket.find((b) => !used.has(b.rid)) ?? bucket[0];
			if (!candidate) return part;
			used.add(candidate.rid);
			// Always prefer the viewer runtime id from the hydrated registry match.
			// Some source lists return table-order ids (0..N) instead of runtime ids.
			const nextId = String(candidate.rid);
			const nextLink = part.link?.trim() ? part.link : candidate.link;
			const nextTargetRuntimeId = part.targetRuntimeId?.trim() || nextId;
			const nextTargetName = part.targetName?.trim() || part.name;
			if (
				nextId === part.id &&
				nextLink === part.link &&
				nextTargetRuntimeId === (part.targetRuntimeId?.trim() || "") &&
				nextTargetName === (part.targetName?.trim() || "")
			) {
				return part;
			}
			return {
				...part,
				id: nextId,
				link: nextLink,
				targetRuntimeId: nextTargetRuntimeId,
				targetName: nextTargetName,
				resolvedViaParent: part.resolvedViaParent ?? false,
			};
		});
	}

	async function applyParentFallbackLinks(input: IfcPart[]): Promise<IfcPart[]> {
		if (!input.length) return input;
		await ensureHierarchyCacheForActiveModel();
		if (parentByRuntimeId.size === 0) return input;
		return input.map((part) => {
			if (isWritableLink(part.link)) return part;
			let cur = Number(part.id);
			if (Number.isNaN(cur)) return part;
			let guard = 0;
			while (!Number.isNaN(cur) && guard < 256) {
				const parent = parentByRuntimeId.get(cur);
				if (parent == null) break;
				const fileId = fileIdByRuntimeId.get(parent);
				if (fileId && !/^\d+$/.test(fileId) && fileId.trim().length >= 8) {
					return {
						...part,
						link: `frn:entity:${fileId.trim()}`,
						targetRuntimeId: String(parent),
						targetName: nameByRuntimeId.get(parent) ?? part.name,
						resolvedViaParent: true,
					};
				}
				cur = parent;
				guard += 1;
			}
			return part;
		});
	}

	async function hydrateLinksFromKnownRegistry(input: IfcPart[]): Promise<IfcPart[]> {
		if (!input.length) return input;
		await ensureHierarchyCacheForActiveModel();
		const knownEntityIds = new Set(
			knownLibraryLinks.map((l) => getEntityIdFromFrn(l)).filter((v): v is string => Boolean(v)),
		);
		const isValidEntityToken = (value: string): boolean => {
			const v = value.trim();
			if (!v) return false;
			if (/^\d+$/.test(v)) return false;
			return /^[0-9A-Za-z_$-]{8,64}$/.test(v);
		};
		return input.map((part) => {
			if (isWritableLink(part.link)) return part;
			let cur = Number(part.id);
			if (Number.isNaN(cur)) return part;
			const candidates: Array<{ runtimeId: number; entityId: string }> = [];
			let guard = 0;
			while (!Number.isNaN(cur) && guard < 256) {
				const fileId = fileIdByRuntimeId.get(cur);
				if (fileId && isValidEntityToken(fileId)) {
					candidates.push({ runtimeId: cur, entityId: fileId.trim() });
				}
				const parent = parentByRuntimeId.get(cur);
				if (parent == null) break;
				cur = parent;
				guard += 1;
			}
			if (!candidates.length) return part;
			const preferred =
				candidates.find((c) => knownEntityIds.has(c.entityId)) ??
				(knownEntityIds.size === 0 ? candidates[0] : undefined);
			if (!preferred) return part;
			return {
				...part,
				link: `frn:entity:${preferred.entityId}`,
				targetRuntimeId: String(preferred.runtimeId),
				targetName: nameByRuntimeId.get(preferred.runtimeId) ?? part.name,
				resolvedViaParent: preferred.runtimeId !== Number(part.id),
			};
		});
	}

	async function hydrateLinksFromObjectPropertiesStrict(input: IfcPart[]): Promise<IfcPart[]> {
		if (!input.length) return input;
		const viewer = api.viewer;
		if (!viewer?.getObjectProperties) return input;
		await ensureHierarchyCacheForActiveModel();
		const activeModelId = getActiveModelId();
		const openModel = allIfcModels.find(
			(m) => activeModelId === m.id || activeModelId === m.versionId,
		);
		const modelCandidates = [openModel?.id, openModel?.versionId, activeModelId].filter(
			(v): v is string => typeof v === "string" && v.trim().length > 0,
		);
		if (!modelCandidates.length) return input;
		const UUID_RE =
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
		const IFC_COMPRESSED_GUID_RE = /^[0-9A-Za-z_$]{22}$/;
		const isLikelyStableEntityId = (value: string): boolean => {
			const v = value.trim();
			if (!v) return false;
			if (UUID_RE.test(v)) return true;
			if (IFC_COMPRESSED_GUID_RE.test(v)) return true;
			return false;
		};
		const extractStableEntityLinkFromPayload = (root: unknown): string | undefined => {
			let foundFrnEntity: string | undefined;
			let foundStableId: string | undefined;
			const guidKeys = new Set([
				"guid",
				"globalid",
				"ifcguid",
				"fileid",
				"entityid",
				"objectid",
			]);
			const walk = (node: unknown, depth: number): void => {
				if (depth > 18 || node == null) return;
				if (Array.isArray(node)) {
					for (const item of node) walk(item, depth + 1);
					return;
				}
				if (typeof node !== "object") return;
				const o = node as Record<string, unknown>;
				const nvName =
					typeof o.name === "string"
						? o.name.toLowerCase().trim()
						: typeof o.key === "string"
							? o.key.toLowerCase().trim()
							: undefined;
				const nvValue =
					typeof o.value === "string"
						? o.value.trim()
						: typeof o.val === "string"
							? o.val.trim()
							: undefined;
				if (nvName && nvValue && guidKeys.has(nvName) && isLikelyStableEntityId(nvValue)) {
					foundStableId = nvValue;
				}
				for (const [k, v] of Object.entries(o)) {
					if (typeof v === "string") {
						const sv = v.trim();
						const lk = k.toLowerCase();
						if (!sv) continue;
						if ((lk === "frn" || lk === "link") && sv.startsWith("frn:entity:")) {
							foundFrnEntity = sv;
						}
						if (guidKeys.has(lk) && isLikelyStableEntityId(sv)) {
							foundStableId = sv;
						}
					} else if (v && typeof v === "object") {
						walk(v, depth + 1);
					}
				}
			};
			walk(root, 0);
			if (foundFrnEntity) return normalizeKnownLink(foundFrnEntity);
			if (foundStableId) return `frn:entity:${foundStableId}`;
			return undefined;
		};
		const result: IfcPart[] = [];
		for (const part of input) {
			if (isWritableLink(part.link)) {
				result.push(part);
				continue;
			}
			const rid = Number(part.id);
			if (Number.isNaN(rid)) {
				result.push(part);
				continue;
			}
			const chain: number[] = [rid];
			let cur: number | null | undefined = rid;
			let guard = 0;
			while (typeof cur === "number" && !Number.isNaN(cur) && guard < 128) {
				const parent = parentByRuntimeId.get(cur);
				if (parent == null) break;
				chain.push(parent);
				cur = parent;
				guard += 1;
			}
			let found: string | undefined;
			for (const modelId of modelCandidates) {
				try {
					const payload = await viewer.getObjectProperties(modelId, chain);
					if (!Array.isArray(payload)) continue;
					for (const row of payload) {
						const link = extractStableEntityLinkFromPayload(row);
						if (link) {
							found = link;
							break;
						}
					}
					if (found) break;
				} catch {
					/* try next model candidate */
				}
			}
			result.push(
				found
					? {
							...part,
							link: found,
							targetRuntimeId: part.targetRuntimeId?.trim() || part.id,
							targetName: part.targetName?.trim() || part.name,
							resolvedViaParent: part.resolvedViaParent ?? false,
					  }
					: part,
			);
		}
		return result;
	}

	async function ensureHierarchyCacheForActiveModel(): Promise<void> {
		const viewer = api.viewer;
		if (!viewer?.getHierarchyChildren) return;
		const activeModelId = getActiveModelId();
		if (!activeModelId) return;
		if (hierarchyCacheModelId === activeModelId && parentByRuntimeId.size > 0) return;
		parentByRuntimeId.clear();
		fileIdByRuntimeId.clear();
		nameByRuntimeId.clear();
		hierarchyCacheModelId = activeModelId;

		const queue: Array<{ parent: number; childrenOf: number[] }> = [
			{ parent: 0, childrenOf: [0] },
		];
		const visitedParents = new Set<number>();
		const MAX_NODES = 20000;
		let seenNodes = 0;
		while (queue.length > 0 && seenNodes < MAX_NODES) {
			const cur = queue.shift();
			if (!cur) break;
			for (const pid of cur.childrenOf) {
				if (visitedParents.has(pid)) continue;
				visitedParents.add(pid);
				let children: Array<{ id: number; fileId: string; name: string }> = [];
				try {
					children = await viewer.getHierarchyChildren(activeModelId, [pid], undefined, false);
				} catch {
					continue;
				}
				for (const child of children ?? []) {
					if (typeof child?.id !== "number" || Number.isNaN(child.id)) continue;
					if (!parentByRuntimeId.has(child.id)) {
						parentByRuntimeId.set(child.id, pid === 0 ? null : pid);
						if (typeof child.name === "string" && child.name.trim()) {
							nameByRuntimeId.set(child.id, child.name.trim());
						}
						if (typeof child.fileId === "string" && child.fileId.trim()) {
							fileIdByRuntimeId.set(child.id, child.fileId.trim());
						}
						seenNodes += 1;
						queue.push({ parent: child.id, childrenOf: [child.id] });
					}
				}
			}
		}
	}

	/**
	 * Map `frn:entity:*` to a viewer runtime id so Select in 3D can highlight the object.
	 * Uses hierarchy fileIds, object registry scan, and a small in-memory cache.
	 */
	async function resolveRuntimeForEntityLink(
		entityLink: string,
	): Promise<{ modelId: string; runtimeId: number } | undefined> {
		const trimmed = normalizeKnownLink(entityLink);
		if (!trimmed.startsWith("frn:entity:")) return undefined;

		const cached = entityLinkToRuntimeCache.get(trimmed);
		if (cached) return cached;

		const entityId = getEntityIdFromFrn(trimmed);
		if (!entityId) return undefined;

		const activeModelId = getActiveModelId();
		if (!activeModelId) return undefined;

		const partMatch = parts.find((p) => normalizeKnownLink(p.link) === trimmed);
		if (partMatch) {
			const rid = Number(partMatch.id);
			if (isValidRuntimeId(rid)) {
				const hit = {
					modelId: partMatch.modelId ?? activeModelId,
					runtimeId: rid,
				};
				entityLinkToRuntimeCache.set(trimmed, hit);
				return hit;
			}
		}

		await ensureHierarchyCacheForActiveModel();
		for (const [rid, fid] of fileIdByRuntimeId.entries()) {
			if (fid && entityIdTokensMatch(fid, entityId)) {
				const hit = { modelId: activeModelId, runtimeId: rid };
				entityLinkToRuntimeCache.set(trimmed, hit);
				return hit;
			}
		}

		const viewer = api.viewer as WorkspaceApi["viewer"] & {
			getObjects?: (
				selector?: {
					modelObjectIds?: Array<{
						modelId: string;
						objectRuntimeIds?: number[];
					}>;
				},
			) => Promise<Array<{ modelId?: string; objects?: unknown }>>;
		};

		const tryMatchObject = (o: Record<string, unknown>): number | undefined => {
			const rid =
				typeof o.objectRuntimeId === "number"
					? o.objectRuntimeId
					: typeof o.id === "number"
						? o.id
						: typeof o.runtimeId === "number"
							? o.runtimeId
							: NaN;
			if (!isValidRuntimeId(rid)) return undefined;
			for (const k of [
				"fileId",
				"frn",
				"link",
				"guid",
				"globalId",
				"globalid",
				"entityId",
			]) {
				const v = o[k];
				if (typeof v !== "string" || !v.trim()) continue;
				const sv = v.trim();
				if (sv.startsWith("frn:entity:")) {
					const inner = sv.slice("frn:entity:".length);
					if (entityIdTokensMatch(inner, entityId)) return rid;
				} else if (entityIdTokensMatch(sv, entityId)) {
					return rid;
				}
			}
			return undefined;
		};

		if (typeof viewer?.getObjects === "function") {
			try {
				const rows = await viewer.getObjects({
					modelObjectIds: [{ modelId: activeModelId }],
				});
				for (const row of rows ?? []) {
					const rowMid = typeof row?.modelId === "string" ? row.modelId : "";
					if (rowMid && rowMid !== activeModelId) continue;
					const objects = row?.objects;
					if (!Array.isArray(objects)) continue;
					for (const item of objects) {
						if (!item || typeof item !== "object") continue;
						const rid = tryMatchObject(item as Record<string, unknown>);
						if (rid != null) {
							const hit = { modelId: activeModelId, runtimeId: rid };
							entityLinkToRuntimeCache.set(trimmed, hit);
							return hit;
						}
					}
				}
			} catch {
				/* ignore */
			}
			try {
				const modelRows = await viewer.getObjects();
				for (const row of modelRows ?? []) {
					const rowMid = typeof row?.modelId === "string" ? row.modelId : "";
					if (rowMid && rowMid !== activeModelId) continue;
					const objects = row?.objects;
					if (!Array.isArray(objects)) continue;
					for (const item of objects) {
						if (!item || typeof item !== "object") continue;
						const rid = tryMatchObject(item as Record<string, unknown>);
						if (rid != null) {
							const hit = { modelId: activeModelId, runtimeId: rid };
							entityLinkToRuntimeCache.set(trimmed, hit);
							return hit;
						}
					}
				}
			} catch {
				/* ignore */
			}
		}

		return undefined;
	}

	async function syncViewerSelectionFromKnownLink(link: string): Promise<void> {
		const v = api.viewer;
		if (!viewerOnly || !v?.setSelection) return;
		const trimmed = normalizeKnownLink(link);
		if (!trimmed) return;

		let modelId: string | undefined;
		let runtimeId: number | undefined;

		const runtimeMatch = trimmed.match(
			/^frn:tc:project:[^:]+:model:([^:]+):entity:(\d+)$/i,
		);
		if (runtimeMatch) {
			modelId = runtimeMatch[1];
			runtimeId = Number(runtimeMatch[2]);
		}

		if (
			(!modelId || runtimeId == null || !isValidRuntimeId(runtimeId)) &&
			trimmed.startsWith("frn:entity:")
		) {
			const resolved = await resolveRuntimeForEntityLink(trimmed);
			if (resolved) {
				modelId = resolved.modelId;
				runtimeId = resolved.runtimeId;
			}
		}

		if (!modelId || runtimeId == null || !isValidRuntimeId(runtimeId)) {
			setStatus(
				`Could not map this link to a 3D runtime id yet (try Reload model). Assign/write still targets: ${trimmed}`,
			);
			return;
		}

		const activeModelId = getActiveModelId();
		const currentOpenModel = allIfcModels.find(
			(m) => activeModelId === m.id || activeModelId === m.versionId,
		);
		const modelCandidates = [
			modelId,
			activeModelId,
			currentOpenModel?.id,
			currentOpenModel?.versionId,
		].filter((m): m is string => typeof m === "string" && m.trim().length > 0);

		for (const candidateModelId of [...new Set(modelCandidates)]) {
			try {
				await v.setSelection(
					{
						modelObjectIds: [
							{ modelId: candidateModelId, objectRuntimeIds: [runtimeId] },
						],
					},
					"set",
				);
				setStatus(
					`Viewer selected from link: ${trimmed} (model ${candidateModelId}, runtime ${runtimeId})`,
				);
				return;
			} catch {
				/* try next model id alias */
			}
		}
		setStatus(`Failed to apply viewer selection for link: ${trimmed}`, "error");
	}

	function summarizeWriteTargets(
		source: IfcPart[],
		fallbackKnownLink?: string,
	): string {
		if (!source.length) return "(none)";
		const labels = source.map((part) => {
			const rid = Number(part.id);
			const ridText =
				/^\s*frn:/i.test(part.id)
					? "link-only"
					: Number.isNaN(rid)
						? part.id
						: String(rid);
			const linkText = part.link?.trim() || fallbackKnownLink?.trim() || "(no link)";
			return `${part.name} [rid:${ridText}] -> ${linkText}`;
		});
		const maxInline = 2;
		if (labels.length <= maxInline) return labels.join(" | ");
		return `${labels.slice(0, maxInline).join(" | ")} | +${labels.length - maxInline} more`;
	}

	function buildWbsPropertyValue(row: string[]): string {
		const wbs = (row[1] ?? "").trim();
		const description = (row[3] ?? "").trim();
		if (wbs && description) return `${wbs} - ${description}`;
		return wbs || description || "";
	}

	function findWbsRowIndexForPsetValue(storedValue: string): number | null {
		const want = storedValue.trim();
		if (!want) return null;
		for (let i = 0; i < tableData.rows.length; i++) {
			if (buildWbsPropertyValue(tableData.rows[i]).trim() === want) return i;
		}
		return null;
	}

	function mergeAssignmentsFromPsetApi(apiRows: WbsPsetModelAssignmentRow[]): void {
		if (!apiRows.length) return;
		const activeModelId = getActiveModelId();
		const byLink = new Map<string, WbsAssignment>();
		const unkeyed: WbsAssignment[] = [];
		for (const a of assignments) {
			const k = normalizeKnownLink(a.targetLink);
			if (k) byLink.set(k, a);
			else unkeyed.push(a);
		}
		for (const row of apiRows) {
			const k = normalizeKnownLink(row.link);
			if (!k) continue;
			const idx = findWbsRowIndexForPsetValue(row.value);
			const prev = byLink.get(k);
			const wbsValues =
				idx !== null && tableData.rows[idx]
					? [...tableData.rows[idx]]
					: prev?.wbsValues?.length
						? [...prev.wbsValues]
						: ["", "", "", ""];
			const wbsRowIndex =
				idx !== null
					? idx
					: prev && prev.wbsRowIndex >= 0
						? prev.wbsRowIndex
						: -1;
			const prevPartId = prev?.partId?.trim() ?? "";
			const keepRuntimePartId =
				/^\d+$/.test(prevPartId) && isValidRuntimeId(Number(prevPartId));
			byLink.set(k, {
				partId: keepRuntimePartId ? prevPartId : k,
				partName: prev?.partName ?? "Known Link Target",
				partType: prev?.partType ?? "PSET",
				partMaterial: prev?.partMaterial ?? "N/A",
				targetLink: k,
				modelId: prev?.modelId ?? activeModelId,
				wbsRowIndex,
				wbsValues,
				propertySetName: "Pset_IMASD_WBS",
				propertyName: row.propertyName,
				propertySetValue: row.value,
				assignedAt: new Date().toISOString(),
			});
		}
		assignments = [...unkeyed, ...byLink.values()];
	}

	async function syncSelectedPartsFromViewerNative(): Promise<void> {
		const viewer = api.viewer as WorkspaceApi["viewer"] & {
			getSelection?: () => Promise<{
				modelObjectIds?: Array<{
					modelId?: string;
					objectRuntimeIds?: number[];
				}>;
			}>;
			getObjects?: (
				selector?: { selected?: boolean },
				objectState?: Record<string, unknown>,
			) => Promise<Array<{ modelId?: string; objects?: unknown }>>;
		};
		const activeModelId = getActiveModelId();
		if (!activeModelId) return;

		const runtimeIds = new Set<number>();
		const currentOpenModel = allIfcModels.find(
			(m) => activeModelId === m.id || activeModelId === m.versionId,
		);
		const modelMatchesActive = (mid: string | undefined): boolean => {
			if (!currentOpenModel) return !mid || mid === activeModelId;
			// Omitting modelId is only unambiguous when a single IFC is available.
			if (!mid) return allIfcModels.length <= 1;
			return (
				mid === currentOpenModel.id || mid === currentOpenModel.versionId
			);
		};
		try {
			if (typeof viewer?.getSelection === "function") {
				const sel = await viewer.getSelection();
				for (const row of sel?.modelObjectIds ?? []) {
					if (!modelMatchesActive(row?.modelId)) continue;
					for (const rid of row?.objectRuntimeIds ?? []) {
						if (typeof rid === "number" && isValidRuntimeId(rid)) runtimeIds.add(rid);
					}
				}
			}
		} catch {
			/* selection API unavailable */
		}

		if (runtimeIds.size === 0) {
			try {
				// Compatibility fallback for hosts without getSelection:
				// ObjectSelector.selected=true is documented to filter current selection.
				const rows = await viewer?.getObjects?.({ selected: true });
				for (const row of rows ?? []) {
					if (!modelMatchesActive(row?.modelId)) continue;
					const objects = row?.objects;
					if (!Array.isArray(objects)) continue;
					for (const item of objects) {
						if (typeof item === "number" && !Number.isNaN(item)) {
							if (!isValidRuntimeId(item)) continue;
							runtimeIds.add(item);
							continue;
						}
						if (!item || typeof item !== "object") continue;
						const o = item as Record<string, unknown>;
						const rid =
							typeof o.objectRuntimeId === "number"
								? o.objectRuntimeId
								: typeof o.id === "number"
									? o.id
									: typeof o.runtimeId === "number"
										? o.runtimeId
										: null;
						if (typeof rid === "number" && isValidRuntimeId(rid)) runtimeIds.add(rid);
					}
				}
			} catch {
				/* fallback unavailable */
			}
		}
		if (runtimeIds.size === 0) {
			try {
				// Additional compatibility path: some hosts expose selection only via entity state.
				// ViewEntityStates.Selected = 1
				const rows = await viewer?.getObjects?.(undefined, {
					entityState: 1,
				});
				for (const row of rows ?? []) {
					if (!modelMatchesActive(row?.modelId)) continue;
					const objects = row?.objects;
					if (!Array.isArray(objects)) continue;
					for (const item of objects) {
						if (typeof item === "number" && !Number.isNaN(item)) {
							if (!isValidRuntimeId(item)) continue;
							runtimeIds.add(item);
							continue;
						}
						if (!item || typeof item !== "object") continue;
						const o = item as Record<string, unknown>;
						const rid =
							typeof o.objectRuntimeId === "number"
								? o.objectRuntimeId
								: typeof o.id === "number"
									? o.id
									: typeof o.runtimeId === "number"
										? o.runtimeId
										: null;
						if (typeof rid === "number" && isValidRuntimeId(rid)) runtimeIds.add(rid);
					}
				}
			} catch {
				/* entity state fallback unavailable */
			}
		}

		selectedPartIds.clear();
		for (const p of getAssignableParts()) {
			const rid = Number(p.id);
			if (isValidRuntimeId(rid) && runtimeIds.has(rid)) selectedPartIds.add(p.id);
		}
		refreshPartsList();
		if (runtimeIds.size === 0) {
			setStatus(
				"No 3D selection returned (or host does not expose getSelection). Select in the model, then try again.",
				"error",
			);
		} else {
			const selected = getAssignableParts().filter((p) => selectedPartIds.has(p.id));
			const writableSelected = selected.filter((p) => isWritableLink(p.link)).length;
			setStatus(
				writableSelected > 0
					? `Matched ${selectedPartIds.size} of ${runtimeIds.size} selected object(s) to this list.`
					: `Matched ${selectedPartIds.size} of ${runtimeIds.size} selected object(s), but none has a writable link yet. Select a Known link fallback to enable Assign.`,
			);
		}
	}

	function refreshPartsList(): void {
		if (!getActiveModelId()) {
			partsListEl.innerHTML =
				'<p class="text-sm text-gray-500 italic">Select an IFC model to load parts.</p>';
			refreshAssignButton();
			return;
		}
		const writableOnly = getAssignableParts().filter((p) =>
			isWritableLink(p.link),
		);
		partsListEl.innerHTML = renderPartsList(
			writableOnly,
			selectedPartIds,
		);
		refreshAssignButton();
	}

	function refreshPartFilters(): void {
		const assignable = getAssignableParts();
		if (typeFilterEl) {
			const types = [...new Set(assignable.map((part) => part.type))].sort();
			typeFilterEl.innerHTML =
				'<option value="ALL">All Types</option>' +
				types
					.map(
						(value) =>
							`<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`,
					)
					.join("");
		}
		const materials = [...new Set(assignable.map((part) => part.material))].sort();
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
		refreshAssignments();
	}

	function setLastCheckedNow(): void {
		const now = new Date();
		lastCheckedLabelEl.textContent = `Last checked: ${now.toLocaleTimeString()}`;
	}

	/**
	 * Re-sync hidden viewer model id / label when the user switches IFC in Connect.
	 * Returns true when the active model id changed (caller should refetch assemblies).
	 */
	async function rebindViewerModelIfSceneChanged(): Promise<boolean> {
		if (!viewerOnly || !api.viewer?.getModels) return false;
		const list = await resolveViewerModelsForWbs(api);
		if (list.length === 0) return false;
		const chosen: IfcModelOption = {
			id: list[0].id,
			versionId: list[0].versionId,
			name: list[0].name ?? "IFC",
		};
		const prev = getActiveModelId();
		const same =
			chosen.id === prev ||
			(chosen.versionId != null && chosen.versionId === prev);
		if (same) return false;
		allIfcModels = [chosen];
		setViewerModelUi(chosen);
		return true;
	}

	async function loadAssembliesForSelectedModel(forceRefetch: boolean): Promise<void> {
		selectedPartIds.clear();
		await autoLoadKnownLinks(true);
		let sceneChanged = false;
		if (viewerOnly && api.viewer?.getModels) {
			sceneChanged = await rebindViewerModelIfSceneChanged();
		}
		void syncViewerSelection();
		const selectedModelId = getActiveModelId();
		if (!selectedModelId) {
			parts = [];
			refreshPartFilters();
			refreshPartsList();
			setStatus("Select an IFC model to load parts.");
			return;
		}
		if (assignmentsModelId && assignmentsModelId !== selectedModelId) {
			assignments = [];
			refreshAssignments();
		}
		assignmentsModelId = selectedModelId;
		entityLinkToRuntimeCache.clear();

		let loadMessage: string | null = null;
		const cachedParts = partsByModelId.get(selectedModelId);
		const shouldRefetch =
			forceRefetch ||
			sceneChanged ||
			!partsByModelId.has(selectedModelId) ||
			(cachedParts?.length ?? 0) === 0;
		if (shouldRefetch) {
			const selectedModel = allIfcModels.find((model) => model.id === selectedModelId);
			setStatus(
				`Loading IFC objects for ${selectedModel?.name ?? "selected IFC"}… If the file is still processing, this may take up to a few minutes.`,
			);
			partsListEl.innerHTML =
				'<p class="text-sm text-gray-400 italic animate-pulse">Loading objects from IFC (waiting for model tree if processing)…</p>';
			retryAssembliesButtonEl.disabled = true;
			try {
				// Part-first mode: load IFC objects/parts directly.
				const assemblyPartsRaw = await fetchIfcAssembliesFromFile(
					api,
					selectedModelId,
					selectedModel?.versionId,
					selectedModel?.name,
					{ listAllIfcObjects: true, preferStableEntityIds: true },
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
						: "Failed to read objects from viewer.";
				partsListEl.innerHTML = `<p class="text-sm text-red-600">${escapeHtml(loadMessage)}</p>`;
			} finally {
				retryAssembliesButtonEl.disabled = false;
				setLastCheckedNow();
			}
		}

		parts = partsByModelId.get(selectedModelId) ?? [];
		parts = await hydratePartsFromViewerObjectRegistry(parts);
		parts = await hydrateLinksFromKnownRegistry(parts);
		parts = await resolveStableLinksForParts(parts);
		parts = await hydrateLinksFromObjectPropertiesStrict(parts);
		parts = await hydrateLinksFromKnownRegistry(parts);
		parts = await applyParentFallbackLinks(parts);
		for (const p of parts) {
			const l = normalizeKnownLink(p.link);
			if (!l.startsWith("frn:entity:")) continue;
			const rid = Number(p.id);
			if (!isValidRuntimeId(rid)) continue;
			const mid = p.modelId ?? selectedModelId;
			entityLinkToRuntimeCache.set(l, { modelId: mid, runtimeId: rid });
		}
		const assignableIds = new Set(getAssignableParts().map((p) => p.id));
		for (const id of [...selectedPartIds]) {
			if (!assignableIds.has(id)) selectedPartIds.delete(id);
		}
		parentByRuntimeId.clear();
		fileIdByRuntimeId.clear();
		nameByRuntimeId.clear();
		hierarchyCacheModelId = "";
		refreshPartFilters();
		refreshPartsList();
		const selectedModel = allIfcModels.find((model) => model.id === selectedModelId);
		if (loadMessage) {
			setStatus(loadMessage, "error");
			return;
		}

		if (parts.length === 0) {
			setStatus(
				`No IFC objects found for ${selectedModel?.name ?? "selected IFC model"}. Check processing status or tree availability.`,
				"error",
			);
			return;
		}

		const readyCount = countReadyParts(getAssignableParts());
		const ghostCount = Math.max(0, getAssignableParts().length - readyCount);
		if (!ensuredLibraryModelIds.has(selectedModelId)) {
			try {
				const seedTargets = getAssignableParts()
					.map((part) => ({
						link: normalizeKnownLink(part.link),
						value: "",
					}))
					.filter((t) => t.link.startsWith("frn:entity:"));
				const ensured = await ensureWbsLibraryAndAssignmentsForLinks(
					api,
					seedTargets,
				);
				ensuredLibraryModelIds.add(selectedModelId);
				if (ensured.createdLibrary || ensured.createdDefinition) {
					setStatus(
						`Property library initialized for this model (lib: ${ensured.libId}, def: ${ensured.defId}, seeded: ${ensured.missingTargetsSeeded}/${ensured.totalTargets}).`,
					);
				}
			} catch (ensureErr) {
				const ensureMsg =
					ensureErr instanceof Error ? ensureErr.message : String(ensureErr);
				setStatus(`Property library auto-setup failed: ${ensureMsg}`, "error");
			}
		}
		setStatus(
			`Loaded ${parts.length} IFC part/object(s) for ${selectedModel?.name ?? "selected IFC model"}. Writable links ready: ${readyCount}/${getAssignableParts().length} (ghost: ${ghostCount}).`,
		);
		await hydrateWbsAssignmentsFromPsetApi(true);
	}

	let knownLinksLoading = false;
	async function autoLoadKnownLinks(silent = true): Promise<void> {
		if (knownLinksLoading) return;
		knownLinksLoading = true;
		try {
			const res = await loadKnownLibraryLinks(api);
			knownLibraryLinks = [
				...new Set(res.links.map((l) => normalizeKnownLink(l)).filter(Boolean)),
			];

			refreshKnownLinkOptions();
			refreshKnownLinkHint();
			refreshAssignments();
			if (!silent && res.links.length === 0) {
				setStatus(res.message, "error");
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			if (!silent) setStatus(`Failed to load known links: ${msg}`, "error");
		} finally {
			knownLinksLoading = false;
		}
	}

	/** Full PSet list fetch + merge — keep off the hot path (avoid racing writes / duplicate list walks). */
	async function hydrateWbsAssignmentsFromPsetApi(silent = true): Promise<void> {
		try {
			const hydrated = await fetchWbsPsetAssignmentsFromModel(api);
			mergeAssignmentsFromPsetApi(hydrated.items);
			refreshAssignments();
		} catch (hydrateErr) {
			if (!silent) {
				const h =
					hydrateErr instanceof Error ? hydrateErr.message : String(hydrateErr);
				setStatus(`PSet table hydrate failed: ${h}`, "error");
			}
		}
	}

	function refreshModelOptions(): void {
		if (!modelFilterEl) return;
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
			setStatus("Loading open IFC from 3D viewer…");
			if (!api.viewer?.getModels) {
				partsByModelId.clear();
				if (viewerModelLabelEl) {
					viewerModelLabelEl.textContent = "Viewer API unavailable";
				}
				setStatus(
					"Viewer API not available. Use the 3D manifest and open an IFC in the viewer.",
					"error",
				);
				refreshPartsList();
			} else {
				const list = await resolveViewerModelsForWbs(api);

				if (list.length === 0) {
					partsByModelId.clear();
					if (viewerModelLabelEl) {
						viewerModelLabelEl.textContent = "No loaded IFC";
					}
					setStatus(
						"No loaded IFC in the viewer. Open your model in 3D, then Retry.",
						"error",
					);
					refreshPartsList();
				} else {
					const m = list[0];
					const chosen: IfcModelOption = {
						id: m.id,
						versionId: m.versionId,
						name: m.name ?? "IFC",
					};
					allIfcModels = [chosen];
					setViewerModelUi(chosen);
					const multiHint =
						list.length > 1
							? ` (using first of ${list.length} after view / IFC filters)`
							: "";
					setStatus(`Using model: ${chosen.name}${multiHint}.`);
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
				if (modelFilterEl) {
					modelFilterEl.innerHTML =
						'<option value="">No IFC files found in project folders</option>';
				}
				partsByModelId.clear();
				setStatus("No IFC files found in project folders.", "error");
			}

			refreshPartsList();
		}
	} catch {
		if (!viewerOnly && modelFilterEl) {
			modelFilterEl.innerHTML =
				'<option value="">Failed to load IFC files from project</option>';
		}
		if (viewerOnly && viewerModelLabelEl) {
			viewerModelLabelEl.textContent = "Failed to read viewer";
		}
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

	if (viewerOnly && api.viewer?.getModels) {
		window.setInterval(() => {
			void (async () => {
				const changed = await rebindViewerModelIfSceneChanged();
				if (changed) {
					await loadAssembliesForSelectedModel(true);
				}
			})();
		}, 3000);
	}

	modelSearchEl?.addEventListener("input", refreshModelOptions);

	modelFilterEl?.addEventListener("change", async () => {
		await loadAssembliesForSelectedModel(false);
	});

	retryAssembliesButtonEl.addEventListener("click", async () => {
		await loadAssembliesForSelectedModel(true);
	});
	loadKnownLinksButtonEl?.addEventListener("click", async () => {
		await autoLoadKnownLinks(false);
		await hydrateWbsAssignmentsFromPsetApi(false);
	});
	knownLinkSelectEl?.addEventListener("change", () => {
		refreshKnownLinkHint();
		refreshAssignButton();
		refreshAssignments();
	});
	resolveLinksButtonEl?.addEventListener("click", async () => {
		const assignable = getAssignableParts();
		if (!assignable.length) {
			setStatus("No IFC objects loaded to resolve stable GUID links.", "error");
			return;
		}
		const before = countReadyParts(assignable);
		setStatus(
			`Resolving GUID-based writable links for ${assignable.length} IFC object(s)...`,
		);
		const resolved = await resolveStableLinksForParts(assignable);
		const byId = new Map(resolved.map((p) => [p.id, p]));
		parts = parts.map((p) => byId.get(p.id) ?? p);
		const after = countReadyParts(getAssignableParts());
		refreshPartsList();
		if (after > before) {
			setStatus(
				`Resolved ${after - before} additional GUID-linked object(s). Writable: ${after}/${getAssignableParts().length}.`,
			);
		} else {
			setStatus(
				`No additional GUID-linked objects found. Writable: ${after}/${getAssignableParts().length}.`,
				"error",
			);
		}
	});
	psetDebugCheckButtonEl?.addEventListener("click", async () => {
		await refreshPsetDebugInfo();
	});
	modelPsetCheckButtonEl?.addEventListener("click", async () => {
		await refreshModelPsetDebugInfo();
	});
	useViewerSelectionButtonEl?.addEventListener("click", async () => {
		if (!useViewerSelectionButtonEl) return;
		await runWithButtonFeedback(useViewerSelectionButtonEl, "Syncing selection...", async () => {
			await syncSelectedPartsFromViewerNative();
		});
	});

	typeFilterEl?.addEventListener("change", refreshPartsList);
	materialFilterEl.addEventListener("change", refreshPartsList);

	container.addEventListener("click", (event) => {
		const target = event.target as HTMLElement;
		const diagnoseButton = target.closest<HTMLButtonElement>("[data-diagnose-part-id]");
		if (diagnoseButton) {
			const partId = diagnoseButton.dataset.diagnosePartId?.trim();
			if (!partId) return;
			void runWithButtonFeedback(diagnoseButton, "Diagnosing...", async () => {
				await diagnoseStableLinkForPart(partId);
			});
			return;
		}
		const assignLinkButton = target.closest<HTMLButtonElement>("[data-assign-link]");
		if (assignLinkButton) {
			let link = assignLinkButton.dataset.assignLink?.trim() ?? "";
			const partId = assignLinkButton.dataset.assignPartId?.trim();
			const runtimeRaw = assignLinkButton.dataset.assignRuntimeId?.trim();
			const modelIdRaw = assignLinkButton.dataset.assignModelId?.trim();
			void runWithButtonFeedback(assignButtonEl, "Assigning...", async () => {
				if (!link && partId && runtimeRaw && modelIdRaw && /^\d+$/.test(runtimeRaw)) {
					const runtimeId = Number(runtimeRaw);
					if (isValidRuntimeId(runtimeId)) {
						const harvested = await backfillLinkFromRuntimeSelection(
							partId,
							modelIdRaw,
							runtimeId,
						);
						if (harvested) {
							const updated = getAssignableParts().find((p) => p.id === partId);
							link = normalizeKnownLink(updated?.link);
						}
					}
				}
				await assignToTargetLink(link ?? "", partId);
			});
			return;
		}
		const assignmentLinkButton = target.closest<HTMLButtonElement>(
			"[data-assignment-link]",
		);
		if (assignmentLinkButton) {
			const link = assignmentLinkButton.dataset.assignmentLink?.trim();
			const runtimeIdRaw = assignmentLinkButton.dataset.assignmentRuntimeId?.trim();
			const rowModelId = assignmentLinkButton.dataset.assignmentModelId?.trim();
			const partId = assignmentLinkButton.dataset.assignmentPartId?.trim();
			const runtimeId =
				runtimeIdRaw && /^\d+$/.test(runtimeIdRaw) ? Number(runtimeIdRaw) : NaN;
			if (
				viewerOnly &&
				api.viewer?.setSelection &&
				isValidRuntimeId(runtimeId)
			) {
				const activeModelId = getActiveModelId();
				const modelCandidates = [rowModelId, activeModelId].filter(
					(v): v is string => typeof v === "string" && v.trim().length > 0,
				);
				for (const modelId of [...new Set(modelCandidates)]) {
					try {
						void api.viewer.setSelection(
							{
								modelObjectIds: [{ modelId, objectRuntimeIds: [runtimeId] }],
							},
							"set",
						);
						setStatus(
							`Viewer selected from row runtime mapping (model ${modelId}, runtime ${runtimeId}).`,
						);
						if (partId) {
							void backfillLinkFromRuntimeSelection(partId, modelId, runtimeId).then(
								(harvested) => {
									if (harvested) {
										setStatus(
											`Viewer selected and link harvested from properties (model ${modelId}, runtime ${runtimeId}).`,
										);
									}
								},
							);
						}
						return;
					} catch {
						/* try next */
					}
				}
			}
			if (!link || !link.startsWith("frn:")) return;
			void syncViewerSelectionFromKnownLink(link);
			return;
		}
		const partButton = target.closest<HTMLElement>("[data-part-id]");
		if (partButton) {
			const partId = partButton.dataset.partId;
			if (!partId) return;
			if (selectedPartIds.has(partId)) selectedPartIds.delete(partId);
			else selectedPartIds.add(partId);
			refreshPartsList();
			return;
		}
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

	async function assignToTargetLink(
		targetLinkRaw: string,
		preferredPartId?: string,
	): Promise<void> {
		if (selectedWbsRowIndex === null) {
			setStatus("Select a WBS row first.", "error");
			return;
		}
		const assignedRowIndex = selectedWbsRowIndex;
		const selectedRow = tableData.rows[selectedWbsRowIndex];
		if (!selectedRow) return;
		const fallbackKnownLink = normalizeKnownLink(targetLinkRaw);
		const preferredPart = preferredPartId
			? getAssignableParts().find((part) => part.id === preferredPartId)
			: undefined;
		if (!fallbackKnownLink) {
			setStatus("This row is non-writable (no stable link). Use a READY row.", "error");
			return;
		}
		const targetPartMatch = getAssignableParts().find(
			(part) => normalizeKnownLink(part.link) === fallbackKnownLink,
		);
		const selectedPartsRaw = preferredPart
			? [preferredPart]
			: getAssignableParts().filter((part) => selectedPartIds.has(part.id));
		const selectedPartsResolved = await resolveStableLinksForParts(selectedPartsRaw);
		for (const resolved of selectedPartsResolved) {
			const idx = parts.findIndex((p) => p.id === resolved.id);
			if (idx >= 0) parts[idx] = resolved;
		}
		refreshPartsList();
		const selectedPartsForWrite = targetPartMatch
			? [targetPartMatch]
			: selectedPartsResolved.length
			? [selectedPartsResolved[0]]
			: [
					{
						// One synthetic id per PSet target so assignments do not overwrite each other.
						id: normalizeKnownLink(fallbackKnownLink),
						name: "Known Link Target",
						type: "N/A",
						material: "N/A",
						modelId: getActiveModelId(),
						link: fallbackKnownLink,
					} as IfcPart,
				];
		const now = new Date().toISOString();

		selectedPartsForWrite.forEach((part) => {
			assignments = assignments.filter((item) => item.partId !== part.id);
			const propertySetValue = buildWbsPropertyValue(selectedRow);
			const effectiveLink = (part.link || fallbackKnownLink || "").trim();
			assignments.push({
				partId: part.id,
				partName: part.name,
				partType: part.type,
				partMaterial: part.material,
				targetLink: effectiveLink || undefined,
				modelId: part.modelId ?? getActiveModelId(),
				wbsRowIndex: assignedRowIndex,
				wbsValues: selectedRow,
				propertySetName: "Pset_IMASD_WBS",
				propertyName: "Pset_IMASD_WBS",
				propertySetValue,
				assignedAt: now,
			});
		});

		const psetWriteItems = selectedPartsForWrite.map((part) => ({
			modelId: part.modelId ?? getActiveModelId(),
			partId: part.id,
			value: buildWbsPropertyValue(selectedRow),
			link: part.link || fallbackKnownLink,
		}));
		const targetSummary = summarizeWriteTargets(selectedPartsForWrite, fallbackKnownLink);
		try {
			const writeResult = await writeWbsPropertySetValues(api, psetWriteItems);
			for (const part of selectedPartsForWrite) {
				const idx = assignments.findIndex((item) => item.partId === part.id);
				if (idx >= 0) {
					assignments[idx] = { ...assignments[idx], propertyName: writeResult.propertyName };
				}
			}
			refreshAssignments();
			void resolveRuntimeForEntityLink(fallbackKnownLink).then((hit) => {
				if (hit) {
					entityLinkToRuntimeCache.set(normalizeKnownLink(fallbackKnownLink), hit);
				}
			});
			const writtenValue = buildWbsPropertyValue(selectedRow);
			const verify = await verifyWbsValueByLink(
				api,
				normalizeKnownLink(fallbackKnownLink),
				writtenValue,
			);
			const baseMsg = `Assigned WBS row ${assignedRowIndex + 4}. PSet: def=${writeResult.defId}, prop=${writeResult.propertyName}. Target: ${targetSummary}`;
			if (!verify.matchedValue) {
				setStatus(
					`${baseMsg} · PSet API check: ${verify.message} (The 3D object list often shows IFC groups only; Connect Property Sets live on the project link and may not appear there.)`,
					"error",
				);
			} else {
				setStatus(
					`${baseMsg} · Confirmed on Property Set API for this link.`,
				);
			}
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to write property set.";
			setStatus(`Assignment failed: ${message}. Target: ${targetSummary}`, "error");
			refreshAssignments();
		}
	}

	async function diagnoseStableLinkForPart(partId: string): Promise<void> {
		const part = getAssignableParts().find((p) => p.id === partId);
		if (!part) {
			setStatus(`Diagnose failed: part ${partId} not found in current model list.`, "error");
			return;
		}
		const rid = Number(part.id);
		if (Number.isNaN(rid)) {
			setStatus(`Diagnose failed: part ${part.name} has invalid runtime id ${part.id}.`, "error");
			return;
		}
		const activeModelId = getActiveModelId();
		await ensureHierarchyCacheForActiveModel();
		const chain: number[] = [rid];
		let cur: number | null | undefined = rid;
		let guard = 0;
		while (typeof cur === "number" && !Number.isNaN(cur) && guard < 128) {
			const parent = parentByRuntimeId.get(cur);
			if (parent == null) break;
			chain.push(parent);
			cur = parent;
			guard += 1;
		}
		const fileIds = chain
			.map((id) => ({ id, fileId: fileIdByRuntimeId.get(id) ?? null }))
			.filter((x) => x.fileId);

		const viewer = api.viewer;
		const payloadKeyHints: Array<{ rid: number; keys: string[] }> = [];
		const candidateValues: Array<{ rid: number; key: string; value: string }> = [];
		if (viewer?.getObjectProperties) {
			try {
				const payload = await viewer.getObjectProperties(activeModelId, chain);
				if (Array.isArray(payload)) {
					for (let i = 0; i < payload.length; i++) {
						const row = payload[i];
						if (!row || typeof row !== "object") continue;
						const o = row as Record<string, unknown>;
						const ridKey =
							typeof o.id === "number" && !Number.isNaN(o.id) ? o.id : chain[i];
						const keys = Object.keys(o).slice(0, 24);
						payloadKeyHints.push({ rid: ridKey, keys });
						for (const [k, v] of Object.entries(o)) {
							if (typeof v !== "string") continue;
							const sv = v.trim();
							if (!sv) continue;
							const lk = k.toLowerCase();
							if (
								["frn", "link", "guid", "globalid", "ifcguid", "fileid", "entityid", "objectid"].includes(
									lk,
								)
							) {
								candidateValues.push({ rid: ridKey, key: k, value: sv });
							}
						}
					}
				}
			} catch {
				/* ignore payload fetch errors in diagnostics */
			}
		}

		const summary = [
			`Part "${part.name}" rid=${rid}`,
			`chain=${chain.join(" > ")}`,
			`fileIds=${fileIds.length ? fileIds.map((f) => `${f.id}:${f.fileId}`).join(", ") : "(none)"}`,
			`candidates=${candidateValues.length ? candidateValues.map((c) => `${c.rid}.${c.key}=${c.value}`).slice(0, 6).join(" | ") : "(none)"}`,
		].join(" | ");
		console.log("WBS link diagnose", {
			part,
			chain,
			fileIds,
			payloadKeyHints,
			candidateValues,
		});
		setStatus(`Link diagnose: ${summary}`);
	}

	async function backfillLinkFromRuntimeSelection(
		partId: string,
		modelId: string,
		runtimeId: number,
	): Promise<boolean> {
		const viewer = api.viewer;
		if (!viewer) return false;
		try {
			if (viewer.getObjectProperties) {
				const payload = await viewer.getObjectProperties(modelId, [runtimeId]);
				const rows = Array.isArray(payload) ? payload : [payload];
				for (const row of rows) {
					const link = extractStableEntityLinkFromUnknownPayload(row);
					if (!isWritableLink(link)) continue;
					const idx = parts.findIndex((p) => p.id === partId);
					if (idx < 0) return false;
					const current = parts[idx];
					parts[idx] = {
						...current,
						link,
						targetRuntimeId: current.targetRuntimeId?.trim() || String(runtimeId),
						targetName: current.targetName?.trim() || current.name,
					};
					refreshAssignments();
					refreshPartsList();
					return true;
				}
			}
		} catch {
			/* ignore harvest errors */
		}
		type ViewerWithObjects = WorkspaceApi["viewer"] & {
			getObjects?: (
				selector?: {
					modelObjectIds?: Array<{
						modelId: string;
						objectRuntimeIds?: number[];
					}>;
					selected?: boolean;
				},
			) => Promise<Array<{ modelId?: string; objects?: unknown }>>;
		};
		const viewerWithObjects = viewer as ViewerWithObjects;
		if (typeof viewerWithObjects.getObjects === "function") {
			try {
				const rows = await viewerWithObjects.getObjects({
					modelObjectIds: [{ modelId, objectRuntimeIds: [runtimeId] }],
				});
				for (const row of rows ?? []) {
					const objects = row?.objects;
					if (!Array.isArray(objects)) continue;
					for (const obj of objects) {
						const link = extractStableEntityLinkFromUnknownPayload(obj);
						if (!isWritableLink(link)) continue;
						const idx = parts.findIndex((p) => p.id === partId);
						if (idx < 0) return false;
						const current = parts[idx];
						parts[idx] = {
							...current,
							link,
							targetRuntimeId: current.targetRuntimeId?.trim() || String(runtimeId),
							targetName: current.targetName?.trim() || current.name,
						};
						refreshAssignments();
						refreshPartsList();
						return true;
					}
				}
			} catch {
				/* ignore */
			}
			try {
				const selectedRows = await viewerWithObjects.getObjects({ selected: true });
				for (const row of selectedRows ?? []) {
					const rowModelId = typeof row?.modelId === "string" ? row.modelId.trim() : "";
					if (rowModelId && rowModelId !== modelId) continue;
					const objects = row?.objects;
					if (!Array.isArray(objects)) continue;
					for (const obj of objects) {
						if (!obj || typeof obj !== "object") continue;
						const o = obj as Record<string, unknown>;
						const objRid =
							typeof o.objectRuntimeId === "number"
								? o.objectRuntimeId
								: typeof o.id === "number"
									? o.id
									: typeof o.runtimeId === "number"
										? o.runtimeId
										: NaN;
						if (Number.isNaN(objRid) || objRid !== runtimeId) continue;
						const link = extractStableEntityLinkFromUnknownPayload(o);
						if (!isWritableLink(link)) continue;
						const idx = parts.findIndex((p) => p.id === partId);
						if (idx < 0) return false;
						const current = parts[idx];
						parts[idx] = {
							...current,
							link,
							targetRuntimeId: current.targetRuntimeId?.trim() || String(runtimeId),
							targetName: current.targetName?.trim() || current.name,
						};
						refreshAssignments();
						refreshPartsList();
						return true;
					}
				}
			} catch {
				/* ignore */
			}
		}
		return false;
	}

	assignButtonEl.addEventListener("click", async () => {
		if (assignButtonEl.disabled) return;
		await runWithButtonFeedback(assignButtonEl, "Assigning...", async () => {
			await assignToTargetLink(knownLinkSelectEl?.value ?? "");
		});
		refreshAssignButton();
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
			refreshWbsTable();
			setStatus(
				`Loaded ${selectedFile.name} (${tableData.rows.length} rows).`,
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

	void refreshPsetDebugInfo();
	void autoLoadKnownLinks(true).then(() => hydrateWbsAssignmentsFromPsetApi(true));
}
