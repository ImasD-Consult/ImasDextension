export function renderWbs(container: HTMLElement): void {
	container.innerHTML = `
    <h2 class="text-lg font-semibold">WBS</h2>
    <p class="mt-1 text-sm text-gray-500">Upload a WBS file (placeholder)</p>

    <div class="mt-6 max-w-md space-y-4">
      <label class="block text-sm font-medium text-gray-700" for="wbs-file">
        Select file
      </label>
      <input
        id="wbs-file"
        type="file"
        class="block w-full text-sm text-gray-700 file:mr-3 file:rounded file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-medium file:text-brand-700 hover:file:bg-brand-100"
      />
      <button
        type="button"
        class="rounded px-4 py-2 text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        Upload (Coming Soon)
      </button>
    </div>
  `;
}
