import { PSet, ServiceCredentials } from "trimble-connect-sdk";
import type { WorkspaceApi } from "@imasd/shared/trimble";

/** EU — from `GET .../tc/api/2.0/regions` (`serviceRegion: eu`, origin `app21.connect.trimble.com`). */
const EU_PSET_SERVICE_URI =
	"https://pset-api.eu-west-1.connect.trimble.com/v1/";

/**
 * Temporary: always use the EU Property Set API (for testing). Set to `false` to restore
 * region discovery (`/regions`, `VITE_TRIMBLE_CONNECT_REGION`, etc.).
 */
const FORCE_EU_PSET_API_FOR_TESTING = true;

/** Fallback when region discovery fails (NA shard). */
const DEFAULT_PSET_SERVICE_URI =
	"https://pset-api.us-east-1.connect.trimble.com/v1/";
const DEFAULT_LIBRARY_ID = "WBS";
const DEFAULT_DEFINITION_ID = "Pset_IMASD_WBS";
const DEFAULT_PROPERTY_NAME = "Pset_IMASD_WBS";

const REGIONS_JSON_URL = "https://app.connect.trimble.com/tc/api/2.0/regions";

type TrimbleRegionRow = {
	isMaster?: boolean;
	/** e.g. `na`, `eu`, `ap`, `ap2` — matches `VITE_TRIMBLE_CONNECT_REGION` */
	serviceRegion?: string;
	origin?: string;
	/** Regional Property Set service base URL */
	"pset-api"?: string;
};

function hostnameKey(raw: string | undefined): string {
	if (!raw?.trim()) return "";
	try {
		const s = raw.trim().startsWith("//") ? `https:${raw.trim()}` : raw.trim();
		return new URL(s).hostname.toLowerCase();
	} catch {
		return "";
	}
}

/**
 * Origins for the Connect tab hosting the extension.
 * Do **not** add every regional host here — that would match NA first and break EU projects.
 */
function getConnectOriginHintsForPset(): string[] {
	const bases = new Set<string>();
	const env = (
		import.meta as ImportMeta & {
			env?: { VITE_TRIMBLE_CONNECT_ORIGIN?: string };
		}
	).env?.VITE_TRIMBLE_CONNECT_ORIGIN;
	if (env?.trim()) {
		bases.add(env.replace(/\/$/, ""));
	}
	if (typeof window !== "undefined") {
		const w = window as Window & {
			__SMARTPRINT_PRO__?: { TRIMBLE_CONNECT_ORIGIN?: string };
		};
		const rt = w.__SMARTPRINT_PRO__?.TRIMBLE_CONNECT_ORIGIN?.trim();
		if (rt) {
			bases.add(rt.replace(/\/$/, ""));
		}
		if (window.location.ancestorOrigins?.length) {
			for (let i = 0; i < window.location.ancestorOrigins.length; i++) {
				try {
					const { origin, hostname } = new URL(window.location.ancestorOrigins[i]);
					if (/connect\.trimble\.com$/i.test(hostname)) {
						bases.add(origin);
					}
				} catch {
					/* ignore */
				}
			}
		}
	}
	if (typeof document !== "undefined" && document.referrer) {
		try {
			const { origin, hostname } = new URL(document.referrer);
			if (/connect\.trimble\.com$/i.test(hostname)) {
				bases.add(origin);
			}
		} catch {
			/* ignore */
		}
	}
	return [...bases];
}

let cachedRegionsPromise: Promise<TrimbleRegionRow[] | null> | null = null;

async function loadTrimbleRegions(): Promise<TrimbleRegionRow[] | null> {
	if (!cachedRegionsPromise) {
		cachedRegionsPromise = (async () => {
			try {
				const res = await fetch(REGIONS_JSON_URL);
				if (!res.ok) return null;
				const data = (await res.json()) as unknown;
				return Array.isArray(data) ? (data as TrimbleRegionRow[]) : null;
			} catch {
				return null;
			}
		})();
	}
	return cachedRegionsPromise;
}

/**
 * Resolves the Property Set API base URL for the Connect region that hosts the project.
 * Wrong region → common error: "Failed to fetch library descriptor with access control policy".
 */
function psetUrlFromRow(row: TrimbleRegionRow | undefined): string | null {
	const u = row?.["pset-api"];
	if (typeof u === "string" && u.startsWith("http")) {
		return ensureTrailingSlash(u);
	}
	return null;
}

function resolveConnectRegionHint(): string | undefined {
	if (typeof window !== "undefined") {
		const w = window as Window & {
			__SMARTPRINT_PRO__?: { TRIMBLE_CONNECT_REGION?: string };
		};
		const rt = w.__SMARTPRINT_PRO__?.TRIMBLE_CONNECT_REGION?.trim();
		if (rt) return rt.toLowerCase();
	}
	const vite = (
		import.meta as ImportMeta & {
			env?: { VITE_TRIMBLE_CONNECT_REGION?: string };
		}
	).env?.VITE_TRIMBLE_CONNECT_REGION?.trim();
	return vite ? vite.toLowerCase() : undefined;
}

export async function resolvePsetServiceUri(): Promise<string> {
	const env = (
		import.meta as ImportMeta & {
			env?: { VITE_PSET_SERVICE_URI?: string };
		}
	).env?.VITE_PSET_SERVICE_URI;
	if (env?.trim()) {
		return ensureTrailingSlash(env.trim());
	}

	if (FORCE_EU_PSET_API_FOR_TESTING) {
		return ensureTrailingSlash(EU_PSET_SERVICE_URI);
	}

	const rows = await loadTrimbleRegions();
	if (!rows?.length) {
		return ensureTrailingSlash(DEFAULT_PSET_SERVICE_URI);
	}

	/** Match parent Connect tab host (e.g. app21 → EU pset). */
	const hints = getConnectOriginHintsForPset();
	for (const hint of hints) {
		const hk = hostnameKey(hint);
		if (!hk) continue;
		for (const row of rows) {
			if (hostnameKey(row.origin) === hk) {
				const resolved = psetUrlFromRow(row);
				if (resolved) return resolved;
			}
		}
	}

	/**
	 * When the iframe does not expose `ancestorOrigins` / referrer (common), host detection fails.
	 * Set `VITE_TRIMBLE_CONNECT_REGION=eu` (build) or `TRIMBLE_CONNECT_REGION=eu` (Docker `env.js`) for Europe.
	 * Values match `serviceRegion` in `GET .../tc/api/2.0/regions` (`na`, `eu`, `ap`, `ap2`, …).
	 */
	const regionHint = resolveConnectRegionHint();
	if (regionHint) {
		const row = rows.find(
			(r) => (r.serviceRegion ?? "").toLowerCase() === regionHint,
		);
		const resolved = psetUrlFromRow(row);
		if (resolved) return resolved;
	}

	const master = rows.find((r) => r.isMaster === true);
	const fromMaster = psetUrlFromRow(master);
	if (fromMaster) return fromMaster;

	return ensureTrailingSlash(DEFAULT_PSET_SERVICE_URI);
}

export interface WbsPsetWriteItem {
	modelId: string;
	partId: string;
	value: string;
	link?: string;
}

function ensureTrailingSlash(uri: string): string {
	return uri.endsWith("/") ? uri : `${uri}/`;
}

function buildEntityLink(projectId: string, modelId: string, partId: string): string {
	// FRN-style link convention for external resources.
	return `frn:tc:project:${projectId}:model:${modelId}:entity:${partId}`;
}

/** Turn raw PSet API errors into something actionable in Connect Browser. */
function withPsetTroubleshootingHint(apiMessage: string): string {
	const m = apiMessage.trim();
	if (
		m.includes("library descriptor") &&
		m.includes("access control")
	) {
		return (
			`${m} ` +
			"Common causes: (1) Wrong Property Set **region** — EU projects need the EU `pset-api` host. Set **`VITE_TRIMBLE_CONNECT_REGION=eu`** at build, or **`TRIMBLE_CONNECT_REGION=eu`** for Docker/runtime `env.js`, or **`VITE_PSET_SERVICE_URI`** to the `pset-api` URL from `GET .../tc/api/2.0/regions`. " +
			"(2) Library permissions — in Property Set Libraries → your library → Manage access control: use the new permissions model if prompted, Save, then **Publish** the library. " +
			"(3) Confirm library id **WBS** and definition **Pset_IMASD_WBS** match the extension defaults (or your env vars)."
		);
	}
	return m;
}

export async function writeWbsPropertySetValues(
	api: WorkspaceApi,
	items: WbsPsetWriteItem[],
): Promise<void> {
	if (!items.length) return;

	const project = await api.project.getProject();
	if (!project?.id) {
		throw new Error("No project selected.");
	}

	const token = await api.extension.requestPermission("accesstoken");
	if (token === "denied" || token === "pending") {
		throw new Error(
			`Access token ${token}. Please grant permission in extension settings.`,
		);
	}

	const serviceUri = await resolvePsetServiceUri();
	const libId = import.meta.env.VITE_PSET_LIB_ID || DEFAULT_LIBRARY_ID;
	const defId = import.meta.env.VITE_PSET_DEF_ID || DEFAULT_DEFINITION_ID;
	const propertyName = import.meta.env.VITE_PSET_PROPERTY_NAME || DEFAULT_PROPERTY_NAME;

	const pset = new PSet({
		serviceUri,
		credentials: new ServiceCredentials(undefined, token),
	});

	const changesetItems = items.map((item) => ({
		link: item.link || buildEntityLink(project.id, item.modelId, item.partId),
		libId,
		defId,
		props: { [propertyName]: item.value },
	}));

	let response: Awaited<ReturnType<PSet["changeset"]>>;
	try {
		response = await pset.changeset({ items: changesetItems });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(withPsetTroubleshootingHint(msg));
	}

	const inline = response.data as {
		errorCount?: number;
		errors?: Array<{ message?: string }>;
	};

	if ((inline.errorCount ?? 0) > 0) {
		const firstError = inline.errors?.[0]?.message;
		throw new Error(
			withPsetTroubleshootingHint(
				firstError || "Property set write failed for some items.",
			),
		);
	}
}
