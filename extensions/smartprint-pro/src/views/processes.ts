import type { WorkspaceApi } from "@imasd/shared/trimble";
import { escapeHtml } from "@imasd/shared/utils";
import {
	fetchSmartprintFolderProSubfolders,
	fetchProcessAssemblies,
	type AssemblyItem,
} from "../services/folders";

const ROW_BASE =
	"w-full rounded px-3 py-2 text-left text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-brand-500";
const ROW_SELECTED = "bg-brand-100 text-brand-800 ring-1 ring-brand-500";
const ROW_UNSELECTED = "text-gray-800 hover:bg-brand-50 hover:text-brand-700";

function renderAssembliesGrid(
	assemblies: AssemblyItem[],
	selectedId: string | null,
	loading: boolean,
): string {
	if (loading) {
		return '<p class="text-sm text-gray-400 italic py-2 animate-pulse">Loading…</p>';
	}
	if (!assemblies.length) {
		return '<p class="text-sm text-gray-400 italic py-2">Select a process</p>';
	}
	return assemblies
		.map((a) => {
			const isSelected = a.id === selectedId || a.versionId === selectedId;
			const modelId = a.versionId || a.id;
			return `
          <button
            type="button"
            class="${ROW_BASE} ${isSelected ? ROW_SELECTED : ROW_UNSELECTED}"
            data-assembly-id="${escapeHtml(modelId)}"
            data-assembly-name="${escapeHtml(a.name)}"
          >
            ${escapeHtml(a.name)}
          </button>`;
		})
		.join("");
}

export async function renderProcesses(
	container: HTMLElement,
	api: WorkspaceApi,
): Promise<void> {
	container.innerHTML = `
    <h2 class="text-lg font-semibold">Processes</h2>
    <p class="mt-1 text-sm text-gray-500">Processes in smartprintPRO</p>
    <p class="mt-4 text-sm text-gray-400 italic animate-pulse">Loading…</p>
  `;

	try {
		const { items } = await fetchSmartprintFolderProSubfolders(api);

		const subfolderRows = items
			.map(
				(f) => `
          <button
            type="button"
            class="${ROW_BASE} ${ROW_UNSELECTED}"
            data-process-id="${escapeHtml(f.id)}"
            data-process-name="${escapeHtml(f.name)}"
          >
            ${escapeHtml(f.name)}
          </button>`,
			)
			.join("");

		container.innerHTML = `
      <h2 class="text-lg font-semibold">Processes</h2>
      <p class="mt-1 text-sm text-gray-500">Processes in smartprintPRO</p>
      <div class="mt-4 grid grid-cols-3 gap-4 min-h-0">
        <div class="flex flex-col border border-gray-200 rounded-lg overflow-hidden">
          <div class="px-3 py-2 bg-gray-50 border-b border-gray-200 font-medium text-sm text-gray-700">
            Processes
          </div>
          <div class="flex-1 overflow-auto p-2 min-h-[120px]" data-process-list>
            ${items.length ? subfolderRows : '<p class="text-sm text-gray-400 italic py-2">No subfolders found</p>'}
          </div>
        </div>
        <div class="flex flex-col border border-gray-200 rounded-lg overflow-hidden">
          <div class="px-3 py-2 bg-gray-50 border-b border-gray-200 font-medium text-sm text-gray-700">
            Assemblies
          </div>
          <div class="flex-1 overflow-auto p-2 min-h-[120px]" data-assemblies-list>
            <p class="text-sm text-gray-400 italic py-2">Select a process</p>
          </div>
          <div class="px-2 pb-2 border-t border-gray-100 pt-2">
            <button
              type="button"
              class="w-full rounded px-3 py-2 text-sm font-medium bg-brand-600 text-white
                     hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500
                     disabled:opacity-50 disabled:cursor-not-allowed"
              data-see-3d
              disabled
            >
              See 3D
            </button>
          </div>
        </div>
        <div class="flex flex-col border border-gray-200 rounded-lg overflow-hidden">
          <div class="px-3 py-2 bg-gray-50 border-b border-gray-200 font-medium text-sm text-gray-700">
            Parts
          </div>
          <div class="flex-1 overflow-auto p-2 min-h-[120px]">
            <p class="text-sm text-gray-400 italic py-2">—</p>
          </div>
        </div>
      </div>
    `;

		let selectedProcessId: string | null = null;
		let selectedAssemblyId: string | null = null;
		let assemblies: AssemblyItem[] = [];

		const processList = container.querySelector("[data-process-list]");
		const assembliesList = container.querySelector("[data-assemblies-list]");
		const see3dBtn =
			container.querySelector<HTMLButtonElement>("[data-see-3d]");

		function updateAssembliesGrid(): void {
			if (!assembliesList) return;
			assembliesList.innerHTML = renderAssembliesGrid(
				assemblies,
				selectedAssemblyId,
				false,
			);
			// Re-attach click handlers via event delegation (handled below)
		}

		function updateSee3dButton(): void {
			if (!see3dBtn) return;
			see3dBtn.disabled = !selectedAssemblyId;
		}

		container.addEventListener("click", async (e) => {
			const target = e.target as HTMLElement;

			// Process selection
			const processBtn = target.closest<HTMLButtonElement>("[data-process-id]");
			if (processBtn && processList?.contains(processBtn)) {
				const id = processBtn.dataset.processId ?? null;
				if (id === selectedProcessId) return;
				selectedProcessId = id;
				selectedAssemblyId = null;

				// Update process selection visual
				processList
					.querySelectorAll("button[data-process-id]")
					.forEach((btn) => {
						btn.classList.remove(ROW_SELECTED);
						btn.classList.add(ROW_UNSELECTED);
						if (btn === processBtn) {
							btn.classList.remove(ROW_UNSELECTED);
							btn.classList.add(ROW_SELECTED);
						}
					});

				// Load assemblies
				if (assembliesList) {
					assembliesList.innerHTML =
						'<p class="text-sm text-gray-400 italic py-2 animate-pulse">Loading…</p>';
				}
				updateSee3dButton();

				try {
					assemblies = id ? await fetchProcessAssemblies(api, id) : [];
					updateAssembliesGrid();
				} catch {
					assemblies = [];
					if (assembliesList) {
						assembliesList.innerHTML =
							'<p class="text-sm text-red-600 py-2">Failed to load assemblies</p>';
					}
				}
				return;
			}

			// Assembly selection
			const assemblyBtn =
				target.closest<HTMLButtonElement>("[data-assembly-id]");
			if (assemblyBtn && assembliesList?.contains(assemblyBtn)) {
				selectedAssemblyId = assemblyBtn.dataset.assemblyId ?? null;
				updateAssembliesGrid();
				updateSee3dButton();
				return;
			}

			// See 3D button — navigate to native 3D viewer (extension runs in Data view only)
			if (target.closest("[data-see-3d]") && selectedAssemblyId) {
				try {
					const project = await api.project.getProject();
					const projectId = project?.id;
					if (!projectId) {
						alert("No project selected.");
						return;
					}
					const origin =
						window.top?.location?.origin || "https://app21.connect.trimble.com";
					// Open project in 3D viewer; try to deep-link the model
					const base = `${origin}/tc/app`;
					const hash = `#/project/${projectId}/viewer/file/${selectedAssemblyId}`;
					const url = `${base}${hash}`;
					window.top!.location.href = url;
				} catch (err) {
					const msg =
						err instanceof Error ? err.message : "Failed to open 3D viewer";
					alert(msg);
				}
			}
		});
	} catch (err) {
		const message =
			err instanceof Error ? err.message : "Error loading folders";
		container.innerHTML = `
      <h2 class="text-lg font-semibold">Processes</h2>
      <p class="mt-1 text-sm text-gray-500">Processes in smartprintPRO</p>
      <div class="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
        <p class="text-sm text-red-700">${escapeHtml(message)}</p>
      </div>
    `;
	}
}
