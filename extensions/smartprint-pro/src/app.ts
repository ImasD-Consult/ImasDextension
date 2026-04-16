import { connectToTrimble, escapeHtml } from "@imasd/shared";
import type { WorkspaceApi } from "@imasd/shared/trimble";
import { SMARTPRINT_LOGO } from "./assets/logo";
import { renderInfo } from "./views/info";
import { renderProcesses } from "./views/processes";
import { renderQrPanel } from "./views/qr";
import { renderWbs } from "./views/wbs";

function getAppMode(): "project" | "3d" {
	const m = new URLSearchParams(window.location.search).get("mode");
	return m === "3d" ? "3d" : "project";
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
					command !== "info" &&
					command !== "smartprint_main"
				) {
					return;
				}
				container.className = "p-4";
				container.innerHTML = "";
				if (command === "info") {
					renderInfo(container);
				} else {
					await renderProcesses(container, api);
				}
				return;
			}
			if (
				command &&
				command !== "qr" &&
				command !== "wbs" &&
				command !== "smartprint_main"
			) {
				return;
			}
			container.innerHTML = "";
			if (command === "qr") {
				await renderQrPanel(container, api);
				return;
			}
			await renderWbs(container, api, {
				useViewerModelOnly: true,
				horizontalDockLayout: true,
			});
		});

		if (mode === "3d") {
			container.className =
				"h-full min-h-0 w-full flex flex-col overflow-hidden p-2 box-border";
			await api.ui.setMenu({
				title: "smartprintPRO",
				icon: SMARTPRINT_LOGO,
				command: "wbs",
				subMenus: [
					{ title: "WBS", command: "wbs" },
					{ title: "QR Targets", command: "qr" },
				],
			});
			container.innerHTML = "";
			await renderWbs(container, api, {
				useViewerModelOnly: true,
				horizontalDockLayout: true,
			});
			return;
		}

		container.className = "p-4";
		await api.ui.setMenu({
			title: "smartprintPRO",
			icon: SMARTPRINT_LOGO,
			command: "processes",
			subMenus: [
				{ title: "Processes", command: "processes" },
				{ title: "Info", command: "info" },
			],
		});

		container.innerHTML = "";
		await renderProcesses(container, api);
	} catch (err) {
		container.className = "p-4";
		const message = err instanceof Error ? err.message : "Failed to connect";
		container.innerHTML = `
      <h2 class="text-lg font-semibold">smartprintPRO</h2>
      <p class="mt-2 text-sm text-red-600">${escapeHtml(message)}</p>
    `;
	}
}
