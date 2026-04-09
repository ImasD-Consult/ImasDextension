import { connectToTrimble, escapeHtml } from "@imasd/shared";
import type { WorkspaceApi } from "@imasd/shared/trimble";
import { SMARTPRINT_LOGO } from "./assets/logo";
import { renderInfo } from "./views/info";
import { renderProcesses } from "./views/processes";
import { renderWbs } from "./views/wbs";

type Command = "smartprint_main" | "processes" | "wbs" | "info";

async function handleCommand(
	command: string,
	container: HTMLElement,
	api: WorkspaceApi,
): Promise<void> {
	switch (command as Command) {
		case "smartprint_main":
		case "processes":
			await renderProcesses(container, api);
			await api.ui.setActiveMenuItem("processes");
			break;
		case "info":
			renderInfo(container);
			await api.ui.setActiveMenuItem("info");
			break;
		case "wbs":
			renderWbs(container);
			await api.ui.setActiveMenuItem("wbs");
			break;
	}
}

export async function initApp(): Promise<void> {
	const container = document.getElementById("app");
	if (!container) return;

	let api: WorkspaceApi | undefined;

	try {
		api = await connectToTrimble(window.parent, async (command) => {
			if (!api) return;
			await handleCommand(command, container, api);
		});

		await api.ui.setMenu({
			title: "smartprintPRO",
			icon: SMARTPRINT_LOGO,
			command: "smartprint_main",
			subMenus: [
				{ title: "Processes", command: "processes" },
				{ title: "WBS", command: "wbs" },
				{ title: "Info", command: "info" },
			],
		});

		const route = window.location.hash.replace(/^#/, "") || "processes";
		await handleCommand(route, container, api);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Failed to connect";
		container.innerHTML = `
      <h2 class="text-lg font-semibold">smartprintPRO</h2>
      <p class="mt-2 text-sm text-red-600">${escapeHtml(message)}</p>
    `;
	}
}
