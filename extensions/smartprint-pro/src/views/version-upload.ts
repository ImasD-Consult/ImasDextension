import {
	TrimbleClient,
	type TrimbleFolderItem,
	type WorkspaceApi,
} from "@imasd/shared/trimble";

type IndexedFile = {
	id: string;
	versionId?: string;
	name: string;
	parentId: string;
	/** Breadcrumb from project root, e.g. "smartprintPRO / proc06 / pdf". */
	parentFolderPath: string;
};

type UploadResult = {
	fileId: string;
	versionId?: string;
};

type UploadState = {
	selectedLocalFile: File | null;
	selectedMatchId: string;
	matches: IndexedFile[];
	allFiles: IndexedFile[];
	scanning: boolean;
	searchingMatches: boolean;
	matchSearchSeq: number;
	lastUploadMessage: string;
	versionRows: VersionRow[];
};

type VersionRow = {
	fileId: string;
	versionId?: string;
	name: string;
	description?: string;
	updatedAt?: string;
	originalName?: string;
};

const MAX_FOLDERS_TO_SCAN = 3500;
const MAX_CANDIDATES_TO_SHOW = 30;
const DEFAULT_BACKEND_BASE = "https://stamp.imasd.dev";

function normalizeBaseName(name: string): string {
	return name
		.toLowerCase()
		.replace(/\.[^/.]+$/, "")
		.replace(/\b(rev(ision)?|r)\s*[-_.]?\s*\d+\b/g, "")
		.replace(/[\s_.-]+/g, "");
}

function fileExtension(name: string): string {
	const m = name.match(/\.([^.]+)$/);
	return m ? m[1].toLowerCase() : "";
}

function diceCoefficient(a: string, b: string): number {
	if (!a.length || !b.length) return 0;
	if (a === b) return 1;
	if (a.length < 2 || b.length < 2) return 0;
	const bigrams = new Map<string, number>();
	for (let i = 0; i < a.length - 1; i += 1) {
		const bg = a.slice(i, i + 2);
		bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1);
	}
	let hits = 0;
	for (let i = 0; i < b.length - 1; i += 1) {
		const bg = b.slice(i, i + 2);
		const count = bigrams.get(bg) ?? 0;
		if (count > 0) {
			bigrams.set(bg, count - 1);
			hits += 1;
		}
	}
	return (2 * hits) / (a.length + b.length - 2);
}

function escapeHtmlAttr(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Same file name can exist under different paths — show full folder breadcrumb. */
function matchOptionLabel(match: IndexedFile): string {
	const path = match.parentFolderPath?.trim() || "Unknown folder";
	return `${match.name} · ${path}`;
}

function similarityScore(localName: string, tcName: string): number {
	const localNorm = normalizeBaseName(localName);
	const remoteNorm = normalizeBaseName(tcName);
	const extBoost = fileExtension(localName) === fileExtension(tcName) ? 0.2 : 0;
	const stemContainment =
		localNorm.includes(remoteNorm) || remoteNorm.includes(localNorm) ? 0.15 : 0;
	return diceCoefficient(localNorm, remoteNorm) + extBoost + stemContainment;
}

type SmartprintProWindow = Window & {
	__SMARTPRINT_PRO__?: {
		TRIMBLE_CONNECT_ORIGIN?: string;
	};
};

function getRuntimeTrimbleConnectOrigin(): string | undefined {
	if (typeof window === "undefined") return undefined;
	const origin = (window as SmartprintProWindow).__SMARTPRINT_PRO__?.TRIMBLE_CONNECT_ORIGIN?.trim();
	return origin ? origin.replace(/\/$/, "") : undefined;
}

function pickId(item: TrimbleFolderItem): string {
	return item.id || item.versionId || "";
}

async function indexProjectFiles(
	client: TrimbleClient,
	projectId: string,
	rootId: string,
): Promise<IndexedFile[]> {
	const queue: string[] = [rootId];
	const visited = new Set<string>();
	const files: IndexedFile[] = [];
	/** Path string for each folder id (segments joined with " / "), empty for project root. */
	const folderBreadcrumb = new Map<string, string>();
	folderBreadcrumb.set(rootId, "");
	let scanned = 0;

	while (queue.length > 0 && scanned < MAX_FOLDERS_TO_SCAN) {
		const folderId = queue.shift();
		if (!folderId || visited.has(folderId)) continue;
		visited.add(folderId);
		scanned += 1;
		const parentPath = folderBreadcrumb.get(folderId) ?? "";
		const items = await client.listFolderItems(folderId, projectId);
		if (!items?.length) continue;
		for (const item of items) {
			const id = pickId(item);
			const isFolder = item.type?.toUpperCase() === "FOLDER";
			if (isFolder) {
				if (id) {
					queue.push(id);
					const segment = item.name?.trim() || "Folder";
					const childPath = parentPath
						? `${parentPath} / ${segment}`
						: segment;
					folderBreadcrumb.set(id, childPath);
				}
				continue;
			}
			if (!id || !item.name) continue;
			const parentFolderPath =
				parentPath === "" ? "Project" : parentPath;
			files.push({
				id: item.id || id,
				versionId: item.versionId,
				name: item.name,
				parentId: folderId,
				parentFolderPath,
			});
		}
	}
	return files;
}

async function uploadAsVersionName(
	projectId: string,
	token: string,
	parentFolderId: string,
	targetName: string,
	localFile: File,
	probeFileId: string,
): Promise<{
	result: UploadResult;
	metadataSaved: boolean;
	versions: VersionRow[];
}> {
	const backendBase =
		(
			import.meta as ImportMeta & {
				env?: { VITE_BATCH_QR_API_BASE?: string };
			}
		).env?.VITE_BATCH_QR_API_BASE?.trim() || DEFAULT_BACKEND_BASE;
	const url = `${backendBase.replace(/\/+$/, "")}/v1/integrations/trimble/version-upload`;
	const body = new FormData();
	body.append("file", localFile, localFile.name);
	body.append("access_token", token);
	body.append("project_id", projectId);
	body.append("parent_folder_id", parentFolderId);
	body.append("target_name", targetName);
	body.append("original_name", localFile.name);
	body.append("connect_origin", getRuntimeTrimbleConnectOrigin() ?? "");
	// Helps the API pick the same regional host as Trimble for this file (matches batch QR host resolution).
	body.append("probe_file_id", probeFileId);

	const res = await fetch(url, {
		method: "POST",
		body,
	});
	if (!res.ok) {
		const text = await res.text();
		let detail = text;
		try {
			const j = JSON.parse(text) as { message?: string; error?: string };
			if (typeof j.message === "string" && j.message.trim()) {
				detail = j.message.trim();
			}
		} catch {
			// use raw text
		}
		throw new Error(`Backend upload failed: ${res.status} ${detail}`);
	}
	const json = (await res.json()) as {
		fileId?: string;
		versionId?: string;
		metadataSaved?: boolean;
		versions?: VersionRow[];
	};
	if (!json.fileId) {
		throw new Error("Backend upload succeeded but returned no fileId.");
	}
	return {
		result: { fileId: json.fileId, versionId: json.versionId },
		metadataSaved: Boolean(json.metadataSaved),
		versions: Array.isArray(json.versions) ? json.versions : [],
	};
}

export async function renderVersionUploadPanel(
	container: HTMLElement,
	api: WorkspaceApi,
): Promise<void> {
	container.innerHTML = `
    <div class="h-full min-h-0 w-full flex flex-col gap-3 text-gray-900">
      <div class="border-b border-gray-200 pb-2">
        <h2 class="text-base font-semibold">File Version Upload</h2>
        <p class="text-xs text-gray-500">
          Upload a renamed revision as a Trimble Connect version by matching it to an existing file.
        </p>
      </div>

      <p class="text-xs text-gray-600 transition-colors duration-200" data-version-status>
        Loading project files...
      </p>

      <div class="rounded border border-dashed border-gray-300 bg-gray-50 p-4 text-center" data-drop-zone>
        <p class="text-xs text-gray-700">
          Drag and drop a file here
        </p>
        <p class="text-[11px] text-gray-500 mt-1">or</p>
        <label class="inline-flex mt-2 cursor-pointer items-center justify-center rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100">
          Select file
          <input type="file" class="hidden" data-file-input />
        </label>
      </div>

      <div class="rounded border border-gray-200 bg-white p-2 min-h-0">
        <div class="mb-2 flex items-center justify-between gap-2">
          <h4 class="text-xs font-semibold text-gray-800">Match local file to Trimble file</h4>
          <button
            type="button"
            class="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            data-refresh-index
            disabled
          >
            Refresh project index
          </button>
        </div>
        <div class="space-y-2" data-match-area>
          <p class="text-[11px] text-gray-400 italic">No local file selected yet.</p>
        </div>
      </div>

      <button
        type="button"
        class="w-full rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
        data-upload-version
        disabled
      >
        Upload as new version
      </button>

      <div class="rounded border border-gray-200 bg-white p-2 min-h-0">
        <h4 class="text-xs font-semibold text-gray-800 mb-2">Version History / Original Name Metadata</h4>
        <div class="max-h-[28vh] overflow-auto" data-version-table>
          <p class="text-[11px] text-gray-400 italic">Upload a file to see versions and saved metadata.</p>
        </div>
      </div>
    </div>
  `;

	const status = container.querySelector<HTMLElement>("[data-version-status]");
	const dropZone = container.querySelector<HTMLElement>("[data-drop-zone]");
	const fileInput = container.querySelector<HTMLInputElement>("[data-file-input]");
	const refreshButton = container.querySelector<HTMLButtonElement>(
		"[data-refresh-index]",
	);
	const matchArea = container.querySelector<HTMLElement>("[data-match-area]");
	const uploadButton = container.querySelector<HTMLButtonElement>(
		"[data-upload-version]",
	);
	const versionTable = container.querySelector<HTMLElement>("[data-version-table]");

	if (
		!status ||
		!dropZone ||
		!fileInput ||
		!refreshButton ||
		!matchArea ||
		!uploadButton ||
		!versionTable
	) {
		return;
	}

	const applyIndexStatus = (
		variant: "neutral" | "scanning" | "success" | "error",
		text: string,
	): void => {
		status.textContent = text;
		const base = "transition-colors duration-200";
		if (variant === "scanning") {
			status.className = `${base} text-base font-bold text-amber-700 animate-pulse`;
		} else if (variant === "success") {
			status.className = `${base} text-sm font-normal text-green-600`;
		} else if (variant === "error") {
			status.className = `${base} text-sm font-semibold text-red-600`;
		} else {
			status.className = `${base} text-xs text-gray-600`;
		}
	};

	function uploadFeedbackClass(message: string): string {
		const m = message.toLowerCase();
		if (m.includes("upload failed") || m.includes("backend upload failed")) {
			return "text-[13px] font-semibold text-red-600";
		}
		if (m.startsWith("upload complete")) {
			return "text-[13px] font-medium text-green-700";
		}
		return "text-[11px] text-gray-600";
	}

	const project = await api.project.getProject();
	if (!project?.id) {
		applyIndexStatus("error", "No project selected.");
		return;
	}

	const token = await api.extension.requestPermission("accesstoken");
	if (token === "denied" || token === "pending") {
		applyIndexStatus(
			"error",
			`Access token ${token}. Please grant permission in extension settings.`,
		);
		return;
	}

	const client = new TrimbleClient({
		accessToken: token,
		region: "eu",
		useDevProxy: import.meta.env.DEV,
	});

	const state: UploadState = {
		selectedLocalFile: null,
		selectedMatchId: "",
		matches: [],
		allFiles: [],
		scanning: false,
		searchingMatches: false,
		matchSearchSeq: 0,
		lastUploadMessage: "",
		versionRows: [],
	};

	const renderVersionTable = (): void => {
		if (!state.versionRows.length) {
			versionTable.innerHTML =
				'<p class="text-[11px] text-gray-400 italic">No versions loaded yet.</p>';
			return;
		}
		const rows = state.versionRows
			.map((row) => {
				const hasOriginalName = Boolean(row.originalName);
				const badgeClass = hasOriginalName
					? "bg-green-100 text-green-700 border-green-300"
					: "bg-amber-100 text-amber-700 border-amber-300";
				const badgeLabel = hasOriginalName ? "Saved" : "Missing";
				return `
          <tr class="border-b border-gray-100">
            <td class="px-2 py-1 text-[11px] text-gray-700">${row.versionId ?? "-"}</td>
            <td class="px-2 py-1 text-[11px] text-gray-700">${row.name}</td>
            <td class="px-2 py-1 text-[11px] text-gray-700">${row.originalName || "-"}</td>
            <td class="px-2 py-1 text-[11px]">
              <span class="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${badgeClass}">
                ${badgeLabel}
              </span>
            </td>
            <td class="px-2 py-1 text-[11px] text-gray-600">${row.updatedAt ?? "-"}</td>
          </tr>
        `;
			})
			.join("");
		versionTable.innerHTML = `
      <table class="min-w-full border-collapse">
        <thead class="sticky top-0 bg-gray-50">
          <tr class="border-b border-gray-200">
            <th class="px-2 py-1 text-left text-[11px] font-semibold text-gray-700">Version Id</th>
            <th class="px-2 py-1 text-left text-[11px] font-semibold text-gray-700">Trimble Name</th>
            <th class="px-2 py-1 text-left text-[11px] font-semibold text-gray-700">Saved Original Name</th>
            <th class="px-2 py-1 text-left text-[11px] font-semibold text-gray-700">Metadata</th>
            <th class="px-2 py-1 text-left text-[11px] font-semibold text-gray-700">Updated At</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
	};

	const renderMatchArea = (): void => {
		const localFile = state.selectedLocalFile;
		if (!localFile) {
			matchArea.innerHTML =
				'<p class="text-[11px] text-gray-400 italic">No local file selected yet.</p>';
			uploadButton.disabled = true;
			return;
		}
		if (state.searchingMatches) {
			matchArea.innerHTML = `
        <p class="text-xs text-gray-700">Local file: <span class="font-medium">${escapeHtmlAttr(localFile.name)}</span></p>
        <p class="text-[11px] text-gray-500 italic">Looking for similar files in project index...</p>
      `;
			uploadButton.disabled = true;
			return;
		}
		if (!state.matches.length) {
			matchArea.innerHTML = `
        <p class="text-xs text-gray-700">Local file: <span class="font-medium">${escapeHtmlAttr(localFile.name)}</span></p>
        <p class="text-[11px] text-red-600">No similar Trimble files were found. Refresh index or upload manually in Trimble.</p>
      `;
			uploadButton.disabled = true;
			return;
		}

		const options = state.matches
			.map((match) => {
				const selected = match.id === state.selectedMatchId ? "selected" : "";
				const label = matchOptionLabel(match);
				const tip = `${match.name} — ${match.parentFolderPath?.trim() || "Unknown folder"}`;
				return `<option value="${escapeHtmlAttr(match.id)}" title="${escapeHtmlAttr(tip)}" ${selected}>${escapeHtmlAttr(label)}</option>`;
			})
			.join("");

		matchArea.innerHTML = `
      <p class="text-xs text-gray-700">Local file: <span class="font-medium">${escapeHtmlAttr(localFile.name)}</span></p>
      <div class="grid grid-cols-2 gap-2 items-center">
        <p class="text-[11px] text-gray-600">Upload as Trimble name:</p>
        <select
          class="w-full rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-800"
          data-match-select
        >
          ${options}
        </select>
      </div>
      <p class="text-[11px] text-gray-500">
        Each option shows the folder path from the project root (breadcrumb), so identical names like <span class="font-mono">pdf</span> under different branches stay distinct.
        The file is uploaded with the selected name (version chain kept). Original local name is saved in description metadata.
      </p>
      ${
				state.lastUploadMessage
					? `<p class="${uploadFeedbackClass(state.lastUploadMessage)}">${escapeHtmlAttr(state.lastUploadMessage)}</p>`
					: ""
			}
    `;
		uploadButton.disabled = !state.selectedMatchId;
	};

	const buildMatchesFor = (localFile: File): IndexedFile[] => {
		return state.allFiles
			.map((f) => ({
				file: f,
				score: similarityScore(localFile.name, f.name),
			}))
			.filter((row) => row.score >= 0.35)
			.sort((a, b) => b.score - a.score)
			.slice(0, MAX_CANDIDATES_TO_SHOW)
			.map((row) => row.file);
	};

	const refreshProjectIndex = async (): Promise<void> => {
		state.scanning = true;
		refreshButton.disabled = true;
		applyIndexStatus("scanning", "Scanning project files…");
		try {
			const rootId = await client.getProjectRootId(project.id);
			state.allFiles = await indexProjectFiles(client, project.id, rootId);
			applyIndexStatus(
				"success",
				`Indexed ${state.allFiles.length} files.`,
			);
			if (state.selectedLocalFile) {
				state.matches = buildMatchesFor(state.selectedLocalFile);
				state.selectedMatchId = state.matches[0]?.id ?? "";
			}
			renderMatchArea();
		} catch (error) {
			const message = error instanceof Error ? error.message : "Indexing failed.";
			applyIndexStatus("error", `Indexing failed: ${message}`);
		} finally {
			state.scanning = false;
			refreshButton.disabled = false;
		}
	};

	const setLocalFile = (file: File): void => {
		state.selectedLocalFile = file;
		state.lastUploadMessage = "";
		const seq = state.matchSearchSeq + 1;
		state.matchSearchSeq = seq;
		state.searchingMatches = true;
		renderMatchArea();
		void (async () => {
			await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
			const matches = buildMatchesFor(file);
			if (seq !== state.matchSearchSeq) return;
			state.matches = matches;
			state.selectedMatchId = matches[0]?.id ?? "";
			state.searchingMatches = false;
			renderMatchArea();
		})();
	};

	dropZone.addEventListener("dragover", (event) => {
		event.preventDefault();
		dropZone.classList.add("border-brand-500", "bg-brand-50");
	});
	dropZone.addEventListener("dragleave", () => {
		dropZone.classList.remove("border-brand-500", "bg-brand-50");
	});
	dropZone.addEventListener("drop", (event) => {
		event.preventDefault();
		dropZone.classList.remove("border-brand-500", "bg-brand-50");
		const dropped = event.dataTransfer?.files?.[0];
		if (dropped) setLocalFile(dropped);
	});

	fileInput.addEventListener("change", () => {
		const chosen = fileInput.files?.[0];
		if (chosen) setLocalFile(chosen);
	});

	refreshButton.addEventListener("click", () => {
		if (state.scanning) return;
		void refreshProjectIndex();
	});

	container.addEventListener("change", (event) => {
		const target = event.target as HTMLElement;
		const matchSelect = target.closest<HTMLSelectElement>("[data-match-select]");
		if (!matchSelect) return;
		state.selectedMatchId = matchSelect.value;
		renderMatchArea();
	});

	uploadButton.addEventListener("click", () => {
		void (async () => {
			if (!state.selectedLocalFile || !state.selectedMatchId) return;
			const match = state.matches.find((m) => m.id === state.selectedMatchId);
			if (!match) return;
			uploadButton.disabled = true;
			refreshButton.disabled = true;
			state.lastUploadMessage = `Uploading "${state.selectedLocalFile.name}" as "${match.name}"...`;
			renderMatchArea();
			try {
				const upload = await uploadAsVersionName(
					project.id,
					token,
					match.parentId,
					match.name,
					state.selectedLocalFile,
					match.id,
				);
				const metaPart = upload.metadataSaved
					? "Original local name saved in file description metadata."
					: "Uploaded, but metadata could not be saved.";
				state.lastUploadMessage = `Upload complete. Trimble name "${match.name}" kept for versioning. ${metaPart}`;
				state.versionRows = upload.versions;
				renderVersionTable();
			} catch (error) {
				const message = error instanceof Error ? error.message : "Upload failed.";
				state.lastUploadMessage = `Upload failed: ${message}`;
			} finally {
				refreshButton.disabled = false;
				renderMatchArea();
			}
		})();
	});

	refreshButton.disabled = true;
	await refreshProjectIndex();
	renderVersionTable();
}
