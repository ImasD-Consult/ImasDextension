export function renderInfo(container: HTMLElement): void {
	container.innerHTML = `
    <h2 class="text-lg font-semibold">Info</h2>
    <p class="mt-1 text-sm text-gray-500">About smartprintPRO</p>

    <div class="mt-6 space-y-6">
      <section>
        <h3 class="text-sm font-semibold text-gray-700">Contacts</h3>
        <p class="mt-1 text-sm text-gray-600">
          <a href="mailto:info@imasdconsult.com" class="text-blue-600 hover:underline">info@imasdconsult.com</a>
        </p>
      </section>

      <section>
        <h3 class="text-sm font-semibold text-gray-700">Logos</h3>
        <p class="mt-1 text-sm italic text-gray-400">Logo assets</p>
      </section>

      <section>
        <h3 class="text-sm font-semibold text-gray-700">Two manifests (same server)</h3>
        <p class="mt-1 text-sm text-gray-600">
          Use <strong class="text-gray-800">manifest.json</strong> only under <strong>Project → Extensions</strong> (Data / folders), and <strong class="text-gray-800">manifest-3d.json</strong> only under <strong>3D Viewer → Settings → Extensions</strong>. Same app URL; different <code class="text-xs bg-gray-100 px-1 rounded">extensionType</code> avoids duplicate sidebar entries. For assembly loading from the IFC, prefer the 3D viewer install and open the model in 3D.
        </p>
      </section>

      <section>
        <h3 class="text-sm font-semibold text-gray-700">Web Links</h3>
        <p class="mt-1 text-sm text-gray-600">
          <a href="https://imasdconsult.com" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">https://imasdconsult.com</a>
        </p>
      </section>
    </div>
  `;
}
