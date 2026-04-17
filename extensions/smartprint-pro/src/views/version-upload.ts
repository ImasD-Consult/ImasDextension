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
	lastUploadMessage: string;
};

const MAX_FOLDERS_TO_SCAN = 3500;
const MAX_CANDIDATES_TO_SHOW = 30;

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

function similarityScore(localName: string, tcName: string): number {
	const localNorm = normalizeBaseName(localName);
	const remoteNorm = normalizeBaseName(tcName);
	const extBoost = fileExtension(localName) === fileExtension(tcName) ? 0.2 : 0;
	const stemContainment =
		localNorm.includes(remoteNorm) || remoteNorm.includes(localNorm) ? 0.15 : 0;
	return diceCoefficient(localNorm, remoteNorm) + extBoost + stemContainment;
}

function getAuthHeaders(token: string): HeadersInit {
	return {
		Authorization: `Bearer ${token}`,
		Accept: "application/json",
	};
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
	let scanned = 0;

	while (queue.length > 0 && scanned < MAX_FOLDERS_TO_SCAN) {
		const folderId = queue.shift();
		if (!folderId || visited.has(folderId)) continue;
		visited.add(folderId);
		scanned += 1;
		const items = await client.listFolderItems(folderId, projectId);
		if (!items?.length) continue;
		for (const item of items) {
			const id = pickId(item);
			const isFolder = item.type?.toUpperCase() === "FOLDER";
			if (isFolder) {
				if (id) queue.push(id);
				continue;
			}
			if (!id || !item.name) continue;
			files.push({
				id: item.id || id,
				versionId: item.versionId,
				name: item.name,
				parentId: folderId,
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
): Promise<UploadResult> {
	const renamedFile = new File([localFile], targetName, {
		type: localFile.type || "application/octet-stream",
		lastModified: localFile.lastModified,
	});
	const formData = new FormData();
	formData.append("file", renamedFile, targetName);
	formData.append("name", targetName);
	formData.append("parentId", parentFolderId);
	formData.append("projectId", projectId);

	const uploadEndpoints = [
		`/tc/api/2.0/files?projectId=${encodeURIComponent(projectId)}&parentId=${encodeURIComponent(parentFolderId)}`,
		"/tc/api/2.0/files",
	];
	let lastError = "Upload failed.";

	for (const endpoint of uploadEndpoints) {
		try {
			const res = await fetch(endpoint, {
				method: "POST",
				headers: getAuthHeaders(token),
				body: formData,
			});
			if (!res.ok) {
				lastError = `Upload failed (${res.status}) at ${endpoint}`;
				continue;
			}
			const raw = (await res.json()) as Record<string, unknown>;
			const fileId =
				typeof raw.id === "string"
					? raw.id
					: typeof raw.fileId === "string"
						? raw.fileId
						: "";
			const versionId =
				typeof raw.versionId === "string" ? raw.versionId : undefined;
			if (!fileId) {
				lastError = `Upload succeeded but API returned no file id at ${endpoint}`;
				continue;
			}
			return { fileId, versionId };
		} catch (error) {
			lastError = error instanceof Error ? error.message : "Upload request failed.";
		}
	}

	throw new Error(lastError);
}

async function saveOriginalNameMetadata(
	token: string,
	fileId: string,
	originalName: string,
): Promise<void> {
	const payload = {
		description: `[smartprint-original-name] ${originalName}`,
	};
	const endpoints = [
		`/tc/api/2.0/files/${encodeURIComponent(fileId)}`,
		`/tc/api/2.1/files/${encodeURIComponent(fileId)}`,
	];
	for (const endpoint of endpoints) {
		for (const method of ["PATCH", "PUT"] as const) {
			try {
				const res = await fetch(endpoint, {
					method,
					headers: {
						...getAuthHeaders(token),
						"Content-Type": "application/json",
					},
					body: JSON.stringify(payload),
				});
				if (res.ok) return;
			} catch {
				// Continue trying fallback endpoint/method.
			}
		}
	}
	throw new Error(
		"Could not persist original filename metadata in file description.",
	);
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

      <p class="text-xs text-gray-600" data-version-status>
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

	if (!status || !dropZone || !fileInput || !refreshButton || !matchArea || !uploadButton) {
		return;
	}

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

	const state: UploadState = {
		selectedLocalFile: null,
		selectedMatchId: "",
		matches: [],
		allFiles: [],
		scanning: false,
		lastUploadMessage: "",
	};

	const renderMatchArea = (): void => {
		const localFile = state.selectedLocalFile;
		if (!localFile) {
			matchArea.innerHTML =
				'<p class="text-[11px] text-gray-400 italic">No local file selected yet.</p>';
			uploadButton.disabled = true;
			return;
		}
		if (!state.matches.length) {
			matchArea.innerHTML = `
        <p class="text-xs text-gray-700">Local file: <span class="font-medium">${localFile.name}</span></p>
        <p class="text-[11px] text-red-600">No similar Trimble files were found. Refresh index or upload manually in Trimble.</p>
      `;
			uploadButton.disabled = true;
			return;
		}

		const options = state.matches
			.map((match) => {
				const selected = match.id === state.selectedMatchId ? "selected" : "";
				return `<option value="${match.id}" ${selected}>${match.name}</option>`;
			})
			.join("");

		matchArea.innerHTML = `
      <p class="text-xs text-gray-700">Local file: <span class="font-medium">${localFile.name}</span></p>
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
        The file is uploaded with the selected name (version chain kept). Original local name is saved in description metadata.
      </p>
      ${
				state.lastUploadMessage
					? `<p class="text-[11px] text-gray-600">${state.lastUploadMessage}</p>`
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
		status.textContent = "Scanning project files...";
		try {
			const rootId = await client.getProjectRootId(project.id);
			state.allFiles = await indexProjectFiles(client, project.id, rootId);
			status.textContent = `Indexed ${state.allFiles.length} files.`;
			if (state.selectedLocalFile) {
				state.matches = buildMatchesFor(state.selectedLocalFile);
				state.selectedMatchId = state.matches[0]?.id ?? "";
			}
			renderMatchArea();
		} catch (error) {
			const message = error instanceof Error ? error.message : "Indexing failed.";
			status.textContent = `Indexing failed: ${message}`;
		} finally {
			state.scanning = false;
			refreshButton.disabled = false;
		}
	};

	const setLocalFile = (file: File): void => {
		state.selectedLocalFile = file;
		state.lastUploadMessage = "";
		state.matches = buildMatchesFor(file);
		state.selectedMatchId = state.matches[0]?.id ?? "";
		renderMatchArea();
		if (state.matches.length > 0) {
			status.textContent = `${state.matches.length} similar files found. Confirm the target name and upload.`;
		} else {
			status.textContent = "No similar file found. Try another file name or refresh index.";
		}
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
			status.textContent = `Uploading "${state.selectedLocalFile.name}" as "${match.name}"...`;
			try {
				const result = await uploadAsVersionName(
					project.id,
					token,
					match.parentId,
					match.name,
					state.selectedLocalFile,
				);
				try {
					await saveOriginalNameMetadata(
						token,
						result.fileId,
						state.selectedLocalFile.name,
					);
					state.lastUploadMessage =
						"Original local name saved in file description metadata.";
				} catch (metaError) {
					const m =
						metaError instanceof Error ? metaError.message : "Metadata update failed.";
					state.lastUploadMessage = `Uploaded, but metadata warning: ${m}`;
				}
				status.textContent = `Upload complete. Trimble name "${match.name}" kept for versioning.`;
			} catch (error) {
				const message = error instanceof Error ? error.message : "Upload failed.";
				status.textContent = `Upload failed: ${message}`;
			} finally {
				refreshButton.disabled = false;
				renderMatchArea();
			}
		})();
	});

	refreshButton.disabled = true;
	await refreshProjectIndex();
}
