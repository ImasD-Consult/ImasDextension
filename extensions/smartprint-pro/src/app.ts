import { connectToTrimble, escapeHtml } from "@imasd/shared";
import type { WorkspaceApi } from "@imasd/shared/trimble";
import { SMARTPRINT_LOGO } from "./assets/logo";
import { renderInfo } from "./views/info";
import { renderProcesses } from "./views/processes";
import { renderQrPanel } from "./views/qr";
import { renderBatchQrPanel } from "./views/batch-qr";
import { renderVersionUploadPanel } from "./views/version-upload";
import { renderWbs } from "./views/wbs";

function getAppMode(): "project" | "3d" {
	const m = new URLSearchParams(window.location.search).get("mode");
	return m === "3d" ? "3d" : "project";
}

async function render3dPanel(
	container: HTMLElement,
	api: WorkspaceApi,
	panel: "qr" | "wbs",
): Promise<void> {
	container.className =
		"h-full min-h-0 w-full flex flex-col overflow-hidden p-2 box-border";
	container.innerHTML = `
    <div class="shrink-0 flex items-center gap-2 pb-2 border-b border-gray-200">
      <button
        type="button"
        data-panel="qr"
        class="rounded px-3 py-1.5 text-xs font-medium border border-gray-300 text-gray-700 hover:bg-gray-50"
      >
        QR Targets
      </button>
      <button
        type="button"
        data-panel="wbs"
        class="rounded px-3 py-1.5 text-xs font-medium border border-gray-300 text-gray-700 hover:bg-gray-50"
      >
        WBS
      </button>
      <img
        src="${SMARTPRINT_LOGO}"
        alt="smartprintPRO"
        class="ml-auto h-8 w-8 rounded-full object-cover border border-gray-200"
      />
    </div>
    <div class="flex-1 min-h-0 pt-2" data-panel-content></div>
  `;

	const content = container.querySelector<HTMLElement>("[data-panel-content]");
	const panelButtons = container.querySelectorAll<HTMLButtonElement>("[data-panel]");
	if (!content) return;

	const setActivePanel = (active: "qr" | "wbs"): void => {
		panelButtons.forEach((btn) => {
			const isActive = btn.dataset.panel === active;
			btn.classList.toggle("bg-brand-600", isActive);
			btn.classList.toggle("text-white", isActive);
			btn.classList.toggle("border-brand-600", isActive);
			btn.classList.toggle("text-gray-700", !isActive);
		});
	};

	panelButtons.forEach((btn) => {
		btn.addEventListener("click", () => {
			const p = btn.dataset.panel;
			const target: "qr" | "wbs" = p === "qr" ? "qr" : "wbs";
			void render3dPanel(container, api, target);
		});
	});

	setActivePanel(panel);
	content.innerHTML = "";
	if (panel === "qr") {
		await renderQrPanel(content, api);
		return;
	}
	await renderWbs(content, api, {
		useViewerModelOnly: true,
		horizontalDockLayout: true,
	});
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
					command !== "batch_qr_project" &&
					command !== "version_upload_project" &&
					command !== "smartprint_main"
				) {
					return;
				}
				container.className = "p-4";
				container.innerHTML = "";
				if (command === "info") {
					renderInfo(container);
				} else if (command === "batch_qr_project") {
					container.className =
						"h-full min-h-0 w-full flex flex-col overflow-hidden p-2 box-border";
					await renderBatchQrPanel(container, api);
				} else if (command === "version_upload_project") {
					container.className =
						"h-full min-h-0 w-full flex flex-col overflow-hidden p-2 box-border";
					await renderVersionUploadPanel(container, api);
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
			const panel: "qr" | "wbs" = command === "qr" ? "qr" : "wbs";
			await render3dPanel(container, api, panel);
		});

		if (mode === "3d") {
			await api.ui.setMenu({
				title: "smartprintPRO",
				icon: SMARTPRINT_LOGO,
				command: "wbs",
				subMenus: [
					{ title: "QR Targets", command: "qr" },
					{ title: "WBS", command: "wbs" },
				],
			});
			await render3dPanel(container, api, "qr");
			return;
		}

		container.className = "p-4";
		await api.ui.setMenu({
			title: "smartprintPRO",
			icon: SMARTPRINT_LOGO,
			command: "processes",
			subMenus: [
				{ title: "Processes", command: "processes" },
				{ title: "Batch QR", command: "batch_qr_project" },
				{ title: "File Version Upload", command: "version_upload_project" },
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
