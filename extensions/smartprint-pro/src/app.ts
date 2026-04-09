import { connectToTrimble, escapeHtml } from "@imasd/shared";
import type { WorkspaceApi } from "@imasd/shared/trimble";
import { SMARTPRINT_LOGO } from "./assets/logo";
import { renderInfo } from "./views/info";
import { renderProcesses } from "./views/processes";
import { renderWbs } from "./views/wbs";

function getAppMode(): "project" | "3d" {
	const m = new URLSearchParams(window.location.search).get("mode");
	return m === "3d" ? "3d" : "project";
}

/**
 * Runtime fallback: `extension.configure({ type: "properties", height })` for a bottom strip.
 * Prefer registering the 3D manifest with `extensionPoints[].point: "trimble.connect.ui.viewer.data-tab"`
 * (see `manifest-3d.json`) in Trimble Connect Integrations — that targets the same area as the Table of Elements.
 */
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

	const attempts: Record<string, unknown>[] = [
		{ url, title: "smartprintPRO", type: "properties", height: "360px" },
		{ url, title: "smartprintPRO", type: "properties", height: "42vh" },
		{
			url,
			title: "smartprintPRO",
			type: "properties",
			height: "320px",
			extensionType: ["3dviewer"],
		},
	];

	for (const cfg of attempts) {
		try {
			await ext.configure(cfg);
		} catch {
			/* try next variant */
		}
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
				command !== "wbs" &&
				command !== "smartprint_main"
			) {
				return;
			}
			container.innerHTML = "";
			await renderWbs(container, api, {
				useViewerModelOnly: true,
				horizontalDockLayout: true,
			});
		});

		if (mode === "3d") {
			container.className =
				"h-full min-h-0 w-full flex flex-col overflow-hidden p-2 box-border";
			await tryConfigureViewerPanel(api);
			await api.ui.setMenu({
				title: "smartprintPRO",
				icon: SMARTPRINT_LOGO,
				command: "wbs",
			});
			container.innerHTML = "";
			await renderWbs(container, api, {
				useViewerModelOnly: true,
				horizontalDockLayout: true,
			});
			// Second pass after iframe paints — some Connect builds apply `properties` placement only here.
			window.setTimeout(() => {
				if (api) void tryConfigureViewerPanel(api);
			}, 500);
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
