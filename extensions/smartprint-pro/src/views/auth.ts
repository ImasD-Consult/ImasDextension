import { escapeHtml } from "@imasd/shared/utils";
import {
	getPortalRuntimeConfig,
	savePortalRuntimeConfig,
} from "../services/portal-auth";

export async function renderPortalLogin(
	container: HTMLElement,
	onSubmit: (email: string, password: string) => Promise<void>,
): Promise<void> {
	const cfg = getPortalRuntimeConfig();
	container.className = "p-4";
	container.innerHTML = `
    <div class="mx-auto max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 class="text-lg font-semibold">smartprintPRO</h2>
      <p class="mt-1 text-sm text-gray-600">Sign in with your ImasD Portal account.</p>
      <form class="mt-4 space-y-3" data-auth-form>
        <label class="block text-xs font-medium text-gray-700">
          Email
          <input
            type="email"
            name="email"
            class="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            required
          />
        </label>
        <label class="block text-xs font-medium text-gray-700">
          Password
          <input
            type="password"
            name="password"
            class="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            required
          />
        </label>
        <details class="rounded border border-gray-200 bg-gray-50 p-2">
          <summary class="cursor-pointer text-xs font-medium text-gray-700">
            Portal connection settings
          </summary>
          <div class="mt-2 space-y-2">
            <label class="block text-xs font-medium text-gray-700">
              Portal Base URL
              <input
                type="text"
                name="portalBaseUrl"
                class="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                placeholder="https://portal.example.com"
                value="${escapeHtml(cfg.baseUrl ?? "")}"
              />
            </label>
            <label class="block text-xs font-medium text-gray-700">
              Portal Client ID
              <input
                type="text"
                name="portalClientId"
                class="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                placeholder="client-id"
                value="${escapeHtml(cfg.clientId ?? "")}"
              />
            </label>
          </div>
        </details>
        <p class="text-xs text-red-600 min-h-4" data-auth-error></p>
        <button
          type="submit"
          class="w-full rounded bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Sign in
        </button>
      </form>
    </div>
  `;
	const form = container.querySelector<HTMLFormElement>("[data-auth-form]");
	const error = container.querySelector<HTMLElement>("[data-auth-error]");
	if (!form || !error) return;
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		void (async () => {
			const email = (form.elements.namedItem("email") as HTMLInputElement)?.value ?? "";
			const password =
				(form.elements.namedItem("password") as HTMLInputElement)?.value ?? "";
			const portalBaseUrl =
				(form.elements.namedItem("portalBaseUrl") as HTMLInputElement)?.value ?? "";
			const portalClientId =
				(form.elements.namedItem("portalClientId") as HTMLInputElement)?.value ?? "";
			if (portalBaseUrl.trim() && portalClientId.trim()) {
				savePortalRuntimeConfig(portalBaseUrl, portalClientId);
			}
			error.textContent = "";
			try {
				await onSubmit(email.trim(), password);
			} catch (err) {
				const message = err instanceof Error ? err.message : "Login failed.";
				error.innerHTML = escapeHtml(message);
			}
		})();
	});
}
