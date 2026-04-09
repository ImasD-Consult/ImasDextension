import { connectToTrimble, escapeHtml } from "@imasd/shared";
import type { WorkspaceApi } from "@imasd/shared/trimble";
import { SMARTPRINT_LOGO } from "./assets/logo";
import { renderInfo } from "./views/info";
import { renderProcesses } from "./views/processes";
import { renderWbs } from "./views/wbs";

type Command = "smartprint_main" | "processes" | "wbs" | "info";

const ROOT_ID = "smartprint-root";
const NAV_MOUNT_ID = "smartprint-nav-mount";
const CONTENT_ID = "smartprint-content";
const TAB_PARAM = "tab";

function normalizeRoute(raw: string): Command {
	const r = raw.replace(/^#/, "").trim();
	if (
		r === "wbs" ||
		r === "processes" ||
		r === "info" ||
		r === "smartprint_main"
	) {
		return r;
	}
	return "smartprint_main";
}

/** Use query `?tab=` instead of `#hash` so we do not fight Trimble Connect’s own `#/project/...` routing in the host. */
function getTabFromLocation(): Command {
	const t = new URLSearchParams(window.location.search)
		.get(TAB_PARAM)
		?.trim();
	if (
		t === "wbs" ||
		t === "processes" ||
		t === "info" ||
		t === "smartprint_main"
	) {
		return t;
	}
	return "wbs";
}

function setTabQuery(cmd: Command): void {
	const u = new URL(window.location.href);
	u.searchParams.set(TAB_PARAM, cmd);
	history.replaceState(null, "", `${u.pathname}${u.search}`);
}

function renderInPanelNav(active: Command): string {
	const item = (cmd: Command, label: string) => {
		const isOn = active === cmd;
		return `<button type="button" data-sp-tab="${cmd}" class="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
			isOn
				? "border-blue-400 bg-blue-50 text-blue-900"
				: "border-transparent text-gray-600 hover:bg-gray-100"
		}">${label}</button>`;
	};
	return `<nav class="flex flex-wrap gap-1 border-b border-gray-200 pb-2 mb-3 shrink-0" aria-label="smartprintPRO sections">
      ${item("wbs", "WBS")}
      ${item("processes", "Processes")}
      ${item("info", "Info")}
    </nav>`;
}

function ensureShell(container: HTMLElement, active: Command): HTMLElement {
	let root = container.querySelector(`#${ROOT_ID}`);
	if (!root) {
		container.innerHTML = `
      <div id="${ROOT_ID}" class="flex flex-col min-h-[200px] max-h-[min(85vh,900px)]">
        <div id="${NAV_MOUNT_ID}" class="shrink-0"></div>
        <div id="${CONTENT_ID}" class="flex-1 min-h-0 overflow-auto"></div>
      </div>
    `;
	}
	const mount = container.querySelector(`#${NAV_MOUNT_ID}`);
	if (mount) {
		mount.innerHTML = renderInPanelNav(active);
	}
	return container.querySelector(`#${CONTENT_ID}`) as HTMLElement;
}

async function handleCommand(
	command: string,
	container: HTMLElement,
	api: WorkspaceApi,
): Promise<void> {
	const cmd = normalizeRoute(command);
	const content = ensureShell(container, cmd);

	try {
		switch (cmd) {
			case "smartprint_main":
				content.innerHTML = `
          <p class="text-sm text-gray-500">Select <strong class="text-gray-700">WBS</strong>, <strong class="text-gray-700">Processes</strong>, or <strong class="text-gray-700">Info</strong> above.</p>
        `;
				break;
			case "processes":
				await renderProcesses(content, api);
				break;
			case "info":
				renderInfo(content);
				break;
			case "wbs":
				await renderWbs(content, api);
				break;
		}
		try {
			await api.ui.setActiveMenuItem(
				cmd === "smartprint_main" ? "smartprint_main" : cmd,
			);
		} catch {
			/* host may not expose submenu chrome */
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		content.innerHTML = `<p class="text-sm text-red-600">${escapeHtml(message)}</p>`;
	}
}

function bindTabClicks(
	container: HTMLElement,
	runRoute: (raw: string) => void | Promise<void>,
): void {
	container.addEventListener("click", (e) => {
		const btn = (e.target as HTMLElement).closest("[data-sp-tab]");
		if (!btn) return;
		e.preventDefault();
		const tab = btn.getAttribute("data-sp-tab");
		if (
			tab !== "wbs" &&
			tab !== "processes" &&
			tab !== "info" &&
			tab !== "smartprint_main"
		) {
			return;
		}
		setTabQuery(tab);
		void runRoute(tab);
	});
}

export async function initApp(): Promise<void> {
	const container = document.getElementById("app");
	if (!container) return;

	let api: WorkspaceApi | undefined;

	const runRoute = async (raw: string) => {
		if (!api) return;
		const trimmed = raw.trim();
		const route: Command = trimmed === "" ? "wbs" : normalizeRoute(trimmed);
		await handleCommand(route, container, api);
	};

	try {
		api = await connectToTrimble(window.parent, async (command) => {
			if (!api) return;
			const cmd = (command || "smartprint_main").trim();
			if (
				cmd === "wbs" ||
				cmd === "processes" ||
				cmd === "info" ||
				cmd === "smartprint_main"
			) {
				if (getTabFromLocation() !== cmd) {
					setTabQuery(cmd as Command);
					await handleCommand(cmd, container, api);
					return;
				}
			}
			await handleCommand(cmd, container, api);
		});

		await api.ui.setMenu({
			title: "smartprintPRO",
			icon: SMARTPRINT_LOGO,
			command: "smartprint_main",
			subMenus: [
				{ title: "WBS", command: "wbs" },
				{ title: "Processes", command: "processes" },
				{ title: "Info", command: "info" },
			],
		});

		bindTabClicks(container, runRoute);

		window.addEventListener("popstate", () => {
			void runRoute(getTabFromLocation());
		});

		if (!new URLSearchParams(window.location.search).has(TAB_PARAM)) {
			setTabQuery("wbs");
		}
		await runRoute(getTabFromLocation());
	} catch (err) {
		const message = err instanceof Error ? err.message : "Failed to connect";
		container.innerHTML = `
      <h2 class="text-lg font-semibold">smartprintPRO</h2>
      <p class="mt-2 text-sm text-red-600">${escapeHtml(message)}</p>
    `;
	}
}
