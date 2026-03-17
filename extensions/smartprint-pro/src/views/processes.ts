import type { WorkspaceApi } from "@imasd/shared/trimble";
import { escapeHtml } from "@imasd/shared/utils";
import { fetchProjectFolders } from "../services/folders";

export async function renderProcesses(
	container: HTMLElement,
	api: WorkspaceApi,
): Promise<void> {
	container.innerHTML = `
    <h2 class="text-lg font-semibold">Processes</h2>
    <p class="mt-1 text-sm text-gray-500">Folders at project root</p>
    <p class="mt-4 text-sm text-gray-400 italic animate-pulse">Loading…</p>
  `;

	try {
		const { items, source } = await fetchProjectFolders(api);

		if (!items.length) {
			container.innerHTML = `
        <h2 class="text-lg font-semibold">Processes</h2>
        <p class="mt-1 text-sm text-gray-500">
          ${source === "viewer" ? "Models from file tree" : "Folders at project root"}
        </p>
        <p class="mt-4 text-sm text-gray-400 italic">No items found.</p>
      `;
			return;
		}

		const subtitle =
			source === "viewer"
				? "Models from file tree (Viewer API)"
				: "Folders at project root";

		const cards = items
			.map(
				(f) => `
          <button
            type="button"
            class="rounded-lg bg-gray-50 px-4 py-3 text-left text-sm font-medium
                   text-gray-800 transition hover:bg-brand-50 hover:text-brand-700
                   focus:outline-none focus:ring-2 focus:ring-brand-500"
            data-folder-id="${escapeHtml(f.id)}"
          >
            ${escapeHtml(f.name)}
          </button>`,
			)
			.join("");

		container.innerHTML = `
      <h2 class="text-lg font-semibold">Processes</h2>
      <p class="mt-1 text-sm text-gray-500">${subtitle}</p>
      <div class="mt-4 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
        ${cards}
      </div>
    `;
	} catch (err) {
		const message =
			err instanceof Error ? err.message : "Error loading folders";
		container.innerHTML = `
      <h2 class="text-lg font-semibold">Processes</h2>
      <p class="mt-1 text-sm text-gray-500">Folders at project root</p>
      <div class="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
        <p class="text-sm text-red-700">${escapeHtml(message)}</p>
      </div>
    `;
	}
}
