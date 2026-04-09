import { connectToTrimble, escapeHtml } from "@imasd/shared";
import type { WorkspaceApi } from "@imasd/shared/trimble";
import { SMARTPRINT_LOGO } from "./assets/logo";
import { renderProcesses } from "./views/processes";
import { renderWbs } from "./views/wbs";

function getAppMode(): "project" | "3d" {
	const m = new URLSearchParams(window.location.search).get("mode");
	return m === "3d" ? "3d" : "project";
}

async function tryConfigureViewerPanel(api: WorkspaceApi): Promise<void> {
	const ext = api.extension as WorkspaceApi["extension"] & {
		configure?: (c: Record<string, unknown>) => Promise<boolean>;
	};
	if (typeof ext.configure !== "function") return;
	const url =
		(typeof window !== "undefined" &&
			(
				window as Window & {
					__SMARTPRINT_PRO__?: { EXTENSION_URL?: string };
				}
			).__SMARTPRINT_PRO__?.EXTENSION_URL?.trim()) ||
		`${window.location.origin}${window.location.pathname}`;
	try {
		await ext.configure({
			url,
			title: "smartprintPRO",
			extensionType: ["3dviewer"],
			type: "panel",
		});
	} catch {
		/* optional — host may ignore */
	}
}

export async function initApp(): Promise<void> {
	const container = document.getElementById("app");
	if (!container) return;

	const mode = getAppMode();
	let api: WorkspaceApi | undefined;

	try {
		api = await connectToTrimble(window.parent, async (command) => {
			if (!api) return;
			if (mode === "project") {
				if (
					command &&
					command !== "processes" &&
					command !== "smartprint_main"
				) {
					return;
				}
				container.innerHTML = "";
				await renderProcesses(container, api);
				return;
			}
			if (
				command &&
				command !== "wbs" &&
				command !== "smartprint_main"
			) {
				return;
			}
			container.innerHTML = "";
			await renderWbs(container, api, { useViewerModelOnly: true });
		});

		if (mode === "3d") {
			await api.ui.setMenu({
				title: "smartprintPRO",
				icon: SMARTPRINT_LOGO,
				command: "wbs",
			});
			await tryConfigureViewerPanel(api);
			container.innerHTML = "";
			await renderWbs(container, api, { useViewerModelOnly: true });
			return;
		}

		await api.ui.setMenu({
			title: "smartprintPRO",
			icon: SMARTPRINT_LOGO,
			command: "processes",
			subMenus: [{ title: "Processes", command: "processes" }],
		});

		container.innerHTML = "";
		await renderProcesses(container, api);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Failed to connect";
		container.innerHTML = `
      <h2 class="text-lg font-semibold">smartprintPRO</h2>
      <p class="mt-2 text-sm text-red-600">${escapeHtml(message)}</p>
    `;
	}
}
