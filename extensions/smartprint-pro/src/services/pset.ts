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
const DEFAULT_LIBRARY_NAME = "WBS";
const DEFAULT_LIBRARY_ID = "jeefijc4n54851u4blob2sscmjk2mzln";
/**
 * Property set **definition** title in Connect (the block name in the library editor).
 * Your library uses the same label for the block and the schema field: *Pset_IMASD_WBS*.
 * The value written in `props` uses `DEFAULT_PROPERTY_NAME` (also `Pset_IMASD_WBS` by default).
 */
const DEFAULT_DEFINITION_NAME = "Pset_IMASD_WBS";
const DEFAULT_PROPERTY_NAME = "Pset_IMASD_WBS";

const REGIONS_JSON_URL = "https://app.connect.trimble.com/tc/api/2.0/regions";

type SmartprintRuntimeEnv = {
	PSET_SERVICE_URI?: string;
	PSET_LIB_ID?: string;
	PSET_LIBRARY_NAME?: string;
	PSET_DEFINITION_NAME?: string;
	PSET_DEF_ID?: string;
	PSET_PROPERTY_NAME?: string;
};

function runtimeEnv(): SmartprintRuntimeEnv {
	if (typeof window === "undefined") return {};
	const w = window as Window & { __SMARTPRINT_PRO__?: SmartprintRuntimeEnv };
	return w.__SMARTPRINT_PRO__ ?? {};
}

function readPsetEnv(name: keyof SmartprintRuntimeEnv): string | undefined {
	const viteName = `VITE_${name}` as const;
	const vite = (
		import.meta as ImportMeta & {
			env?: Record<string, string | undefined>;
		}
	).env?.[viteName];
	if (typeof vite === "string" && vite.trim()) return vite.trim();
	const rt = runtimeEnv()[name];
	if (typeof rt === "string" && rt.trim()) return rt.trim();
	return undefined;
}

type TrimbleRegionRow = {
	isMaster?: boolean;
	/** e.g. `na`, `eu`, `ap`, `ap2` — matches `VITE_TRIMBLE_CONNECT_REGION` */
	serviceRegion?: string;
	origin?: string;
	/** Regional Property Set service base URL */
	"pset-api"?: string;
	/** Regional Connect Core API base (e.g. `https://app21.connect.trimble.com/tc/api/2.0/`) */
	"tc-api"?: string;
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

function tcApiUrlFromRow(row: TrimbleRegionRow | undefined): string | null {
	const u = row?.["tc-api"];
	if (typeof u === "string" && u.startsWith("http")) {
		return ensureTrailingSlash(u);
	}
	return null;
}

/** Map the chosen Property Set API host to the matching regional Connect Core `tc-api` base (for project JSON). */
async function resolveTcApiBaseForPsetServiceUri(
	psetServiceUri: string,
): Promise<string | null> {
	const rows = await loadTrimbleRegions();
	if (!rows?.length) return null;
	const want = hostnameKey(ensureTrailingSlash(psetServiceUri));
	for (const row of rows) {
		const pset = psetUrlFromRow(row);
		if (!pset) continue;
		if (hostnameKey(pset) === want) {
			return tcApiUrlFromRow(row);
		}
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
	const configured = readPsetEnv("PSET_SERVICE_URI");
	if (configured) {
		return ensureTrailingSlash(configured);
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

export interface WbsPsetWriteResult {
	libId: string;
	defId: string;
	propertyName: string;
}

export interface WbsPsetDebugInfo {
	ok: boolean;
	serviceUri: string;
	configuredLibId: string;
	configuredDefinitionName: string;
	configuredPropertyName: string;
	resolvedLibId?: string;
	resolvedLibName?: string;
	resolvedDefId?: string;
	resolvedDefName?: string;
	resolvedPropertyName?: string;
	resolvedPropertyLabel?: string;
	availableDefinitions?: string[];
	message: string;
}

export interface KnownLibraryLinksResult {
	links: string[];
	message: string;
}

export interface WbsPsetLinkVerificationResult {
	ok: boolean;
	foundLink: boolean;
	matchedValue: boolean;
	libId?: string;
	defId?: string;
	propertyName?: string;
	message: string;
}

function ensureTrailingSlash(uri: string): string {
	return uri.endsWith("/") ? uri : `${uri}/`;
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
			"(3) **Library id** must be the API id (`getLibrary` / `LibraryResponse.id`), not only the folder label. **defId** must be the **definition** id; the extension matches the definition by name (`VITE_PSET_DEFINITION_NAME`, default *Pset_IMASD_WBS*) via `listDefinitions` when `VITE_PSET_DEF_ID` is unset."
		);
	}
	return m;
}

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deep-search Connect Core project JSON for objects that look like a named library
 * (`name` + UUID `id`). Verified later with `getLibrary(id)`.
 */
function collectNamedLibraryIdCandidates(
	data: unknown,
	names: string[],
): string[] {
	const want = new Set(
		names.map((c) => c.trim().toLowerCase()).filter((c) => c.length > 0),
	);
	if (want.size === 0) return [];

	const out: string[] = [];

	function walk(node: unknown, depth: number): void {
		if (depth > 32) return;
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const x of node) walk(x, depth + 1);
			return;
		}
		const o = node as Record<string, unknown>;
		const nm = o.name;
		const id = o.id;
		if (
			typeof nm === "string" &&
			want.has(nm.toLowerCase()) &&
			typeof id === "string" &&
			UUID_RE.test(id)
		) {
			out.push(id);
		}
		for (const v of Object.values(o)) {
			walk(v, depth + 1);
		}
	}

	walk(data, 0);
	return [...new Set(out)];
}

async function fetchConnectProjectDocument(
	tcBase: string,
	projectId: string,
	token: string,
): Promise<unknown | null> {
	const id = encodeURIComponent(projectId);
	const urls: string[] = [];
	if (tcBase.includes("/2.0/")) {
		urls.push(tcBase.replace("/2.0/", "/2.1/") + `projects/${id}`);
	}
	urls.push(`${tcBase}projects/${id}?fullyLoaded=true`);

	for (const url of urls) {
		try {
			const res = await fetch(url, {
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${token}`,
				},
			});
			if (res.ok) {
				return res.json();
			}
		} catch {
			/* try next */
		}
	}
	return null;
}

/**
 * Property Set Service has no `GET .../libs` list endpoint; library ids sometimes appear in
 * Connect Core project JSON (`tc-api` for the same region as `pset-api`).
 */
async function tryResolveLibraryIdFromConnectProject(
	projectId: string,
	token: string,
	psetServiceUri: string,
	displayNames: string[],
	pset: InstanceType<typeof PSet>,
): Promise<string | null> {
	const tcBase = await resolveTcApiBaseForPsetServiceUri(psetServiceUri);
	if (!tcBase) return null;

	const projectJson = await fetchConnectProjectDocument(
		tcBase,
		projectId,
		token,
	);
	if (projectJson === null) return null;

	const candidates = collectNamedLibraryIdCandidates(projectJson, displayNames);
	for (const id of candidates) {
		try {
			await pset.getLibrary(id);
			return id;
		} catch {
			/* not a PSet library id — try next candidate */
		}
	}
	return null;
}

function formatMissingLibraryIdHint(): string {
	return (
		"The folder label (e.g. WBS) is not the PSet library id. " +
		"Set VITE_PSET_LIB_ID to LibraryResponse.id (UUID) from getLibrary. " +
		"To find it: open your project’s Property Set Libraries in Connect (same page as …/property-set-libraries), " +
		"open DevTools → Network, filter by \"pset-api\", click the WBS library, and copy the id from a request URL like …/v1/libs/{uuid}/… . " +
		"See also: https://developer.trimble.com/docs/connect/tools/api/property-set/"
	);
}

function collectSchemaPropertyKeys(
	schemaNode: unknown,
	out: Set<string>,
	depth = 0,
): void {
	if (!schemaNode || typeof schemaNode !== "object" || depth > 12) return;
	const o = schemaNode as Record<string, unknown>;

	const props = o.properties;
	if (props && typeof props === "object" && !Array.isArray(props)) {
		for (const key of Object.keys(props as Record<string, unknown>)) {
			out.add(key);
		}
	}
	// PSet definition schemas commonly use `schema.props` (not JSON Schema `properties`).
	const psetProps = o.props;
	if (psetProps && typeof psetProps === "object" && !Array.isArray(psetProps)) {
		for (const key of Object.keys(psetProps as Record<string, unknown>)) {
			out.add(key);
		}
	}

	for (const k of ["allOf", "anyOf", "oneOf"]) {
		const seq = o[k];
		if (Array.isArray(seq)) {
			for (const item of seq) {
				collectSchemaPropertyKeys(item, out, depth + 1);
			}
		}
	}
	if (o.items) {
		collectSchemaPropertyKeys(o.items, out, depth + 1);
	}
}

function extractDefinitionSchemaPropertyKeys(definitionData: unknown): string[] {
	const keys = new Set<string>();
	if (!definitionData || typeof definitionData !== "object") return [];
	const d = definitionData as Record<string, unknown>;

	const directSchema = d.schema;
	if (directSchema) {
		collectSchemaPropertyKeys(directSchema, keys);
	}
	const latestVersion = d.latestVersion;
	if (latestVersion && typeof latestVersion === "object") {
		collectSchemaPropertyKeys(
			(latestVersion as { schema?: unknown }).schema,
			keys,
		);
	}
	const versions = d.versions;
	if (Array.isArray(versions)) {
		for (const ver of versions) {
			if (ver && typeof ver === "object") {
				collectSchemaPropertyKeys((ver as { schema?: unknown }).schema, keys);
			}
		}
	}

	return [...keys];
}

function extractPropertyDisplayLabel(
	definitionData: unknown,
	propertyKey: string,
): string | undefined {
	if (!definitionData || typeof definitionData !== "object" || !propertyKey.trim()) {
		return undefined;
	}
	let found: string | undefined;
	function walk(node: unknown, depth: number): void {
		if (found || depth > 14 || !node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const item of node) walk(item, depth + 1);
			return;
		}
		const o = node as Record<string, unknown>;
		for (const containerKey of ["props", "properties"]) {
			const props = o[containerKey];
			if (props && typeof props === "object" && !Array.isArray(props)) {
				const rec = props as Record<string, unknown>;
				const target = rec[propertyKey];
				if (target && typeof target === "object") {
					const t = target as Record<string, unknown>;
					for (const k of ["name", "title", "label", "displayName"]) {
						const v = t[k];
						if (typeof v === "string" && v.trim()) {
							found = v.trim();
							return;
						}
					}
				}
			}
		}
		for (const v of Object.values(o)) walk(v, depth + 1);
	}
	walk(definitionData, 0);
	return found;
}

function normalizePropertyKeyCandidates(
	preferred: string,
	definitionName: string,
): string[] {
	const out = new Set<string>();
	if (preferred.trim()) out.add(preferred.trim());
	if (definitionName.trim()) out.add(definitionName.trim());
	if (preferred.startsWith("Pset_")) {
		out.add(preferred.slice("Pset_".length));
	}
	if (definitionName.startsWith("Pset_")) {
		out.add(definitionName.slice("Pset_".length));
	}
	return [...out];
}

function propertyRetryKeys(primary: string): string[] {
	const out = new Set<string>();
	if (primary.trim()) out.add(primary.trim());
	if (primary.startsWith("Pset_") && primary.length > 5) {
		out.add(primary.slice("Pset_".length));
	}
	// Common schema key used in WBS libraries where the visible field is "Group".
	out.add("Group");
	return [...out];
}

async function resolveSchemaPropertyName(
	pset: InstanceType<typeof PSet>,
	libId: string,
	defId: string,
	preferred: string,
	definitionName: string,
): Promise<string> {
	let gd: Awaited<ReturnType<PSet["getDefinition"]>> | null = null;
	try {
		gd = await pset.getDefinition(libId, defId);
	} catch {
		// Continue with version-based schema fallback.
	}

	const keys = new Set<string>();
	if (gd?.data) {
		for (const k of extractDefinitionSchemaPropertyKeys(gd.data)) {
			keys.add(k);
		}
	}

	// Fallback: explicitly load latest schema version and parse its properties.
	if (keys.size === 0) {
		try {
			const versions = await pset.listDefinitionVersions(libId, defId, { top: 1 });
			const rows = (versions.data as { items?: Array<{ v?: number }> })?.items ?? [];
			const latest = rows[0]?.v;
			if (typeof latest === "number") {
				const schemaRes = await pset.getDefinitionVersionBySchema(libId, defId, latest);
				for (const k of extractDefinitionSchemaPropertyKeys({
					schema: schemaRes.data,
				})) {
					keys.add(k);
				}
			}
		} catch {
			/* keep fallback behavior below */
		}
	}

	const keyList = [...keys];
	const candidates = normalizePropertyKeyCandidates(preferred, definitionName);
	for (const c of candidates) {
		if (keyList.includes(c)) return c;
		const ci = keyList.find((k) => k.toLowerCase() === c.toLowerCase());
		if (ci) return ci;
	}

	if (keyList.length === 1) return keyList[0];
	if (keyList.length === 0) return preferred;

	throw new Error(
		`Configured property "${preferred}" is not in definition schema (${defId}). ` +
			`Available properties: ${keyList.join(", ")}. Set VITE_PSET_PROPERTY_NAME to one of these keys.`,
	);
}

/**
 * `defId` in changesets is the **definition** id (node id), not a property name inside the schema.
 * Connect may show the same label for the definition block and the property (e.g. *Pset_IMASD_WBS*).
 */
async function resolveCanonicalLibAndDefIds(
	pset: InstanceType<typeof PSet>,
	projectId: string,
	serviceUri: string,
	token: string,
	configuredLibId: string,
	libraryNameCandidates: string[],
	definitionName: string,
	explicitDefId: string | undefined,
): Promise<{ libId: string; defId: string }> {
	let gl: Awaited<ReturnType<PSet["getLibrary"]>>;
	try {
		gl = await pset.getLibrary(configuredLibId);
	} catch (firstErr) {
		const discovered = await tryResolveLibraryIdFromConnectProject(
			projectId,
			token,
			serviceUri,
			libraryNameCandidates,
			pset,
		);
		if (!discovered) {
			const msg =
				firstErr instanceof Error ? firstErr.message : String(firstErr);
			throw new Error(
				`${msg} Could not load library "${configuredLibId}". ${formatMissingLibraryIdHint()}`,
			);
		}
		try {
			gl = await pset.getLibrary(discovered);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw new Error(
				`${msg} Resolved library id "${discovered}" from Connect project data but getLibrary failed.`,
			);
		}
	}

	const lib = gl.data as { id?: string; name?: string };
	const libId = lib?.id ?? configuredLibId;

	if (explicitDefId) {
		return { libId, defId: explicitDefId };
	}

	let ld: Awaited<ReturnType<PSet["listDefinitions"]>>;
	try {
		ld = await pset.listDefinitions(libId, { top: 500 });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(
			`${msg} Could not list definitions in library "${lib.name ?? libId}".`,
		);
	}

	const page = ld.data as { items?: Array<{ id: string; name: string }> };
	const defs = page?.items ?? [];
	const lower = definitionName.toLowerCase();
	const match = defs.find(
		(d) =>
			d.name?.toLowerCase() === lower ||
			d.id?.toLowerCase() === lower ||
			d.id === definitionName,
	);
	if (match?.id) {
		return { libId, defId: match.id };
	}

	throw new Error(
		`No property set definition matching "${definitionName}" in library "${lib.name ?? libId}". ` +
			`Found: ${defs.map((d) => `${d.name} (${d.id})`).join("; ") || "(none)"}. ` +
			`Set VITE_PSET_DEF_ID to the definition id, or VITE_PSET_DEFINITION_NAME to match the definition title in Connect.`,
	);
}

export async function writeWbsPropertySetValues(
	api: WorkspaceApi,
	items: WbsPsetWriteItem[],
): Promise<WbsPsetWriteResult> {
	if (!items.length) {
		return { libId: "", defId: "", propertyName: "" };
	}

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
	const configuredLibId = readPsetEnv("PSET_LIB_ID") || DEFAULT_LIBRARY_ID;
	const definitionName =
		readPsetEnv("PSET_DEFINITION_NAME") || DEFAULT_DEFINITION_NAME;
	const explicitDefId = readPsetEnv("PSET_DEF_ID");
	const configuredPropertyName =
		readPsetEnv("PSET_PROPERTY_NAME") || DEFAULT_PROPERTY_NAME;

	const libraryNameCandidates = [
		readPsetEnv("PSET_LIBRARY_NAME"),
		DEFAULT_LIBRARY_NAME,
		configuredLibId,
		DEFAULT_LIBRARY_ID,
	].flatMap((s) => (typeof s === "string" && s.trim() ? [s.trim()] : []));

	const pset = new PSet({
		serviceUri,
		credentials: new ServiceCredentials(undefined, token),
	});

	const { libId, defId } = await resolveCanonicalLibAndDefIds(
		pset,
		project.id,
		serviceUri,
		token,
		configuredLibId,
		libraryNameCandidates,
		definitionName,
		explicitDefId,
	);
	const propertyName = await resolveSchemaPropertyName(
		pset,
		libId,
		defId,
		configuredPropertyName,
		definitionName,
	);

	const buildChangesetItems = (propKey: string) =>
		items.map((item) => {
			const explicitLink = item.link?.trim();
			if (explicitLink) {
				return {
					link: explicitLink,
					libId,
					defId,
					props: { [propKey]: item.value },
				};
			}

			const candidate = item.partId?.trim();
			if (candidate && !/^\d+$/.test(candidate) && candidate.length >= 10) {
				return {
					link: `frn:entity:${candidate}`,
					libId,
					defId,
					props: { [propKey]: item.value },
				};
			}

			throw new Error(
				`Could not resolve stable entity link for selected object "${item.partId}". ` +
					`Write aborted to avoid creating PSet on runtime id link. Select an assembly/object with a stable entity id.`,
			);
		});

	const triedKeys: string[] = [];
	const keysToTry = propertyRetryKeys(propertyName);
	let lastErrorMessage = "Property set write failed for some items.";

	for (const key of keysToTry) {
		triedKeys.push(key);
		let response: Awaited<ReturnType<PSet["changeset"]>>;
		try {
			response = await pset.changeset({ items: buildChangesetItems(key) });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			lastErrorMessage = msg;
			if (msg.includes(`Property '${key}' has not been defined`)) {
				continue;
			}
			throw new Error(withPsetTroubleshootingHint(msg));
		}

		const inline = response.data as {
			errorCount?: number;
			errors?: Array<{ message?: string }>;
		};
		if ((inline.errorCount ?? 0) === 0) {
			return { libId, defId, propertyName: key };
		}

		const firstError = inline.errors?.[0]?.message;
		lastErrorMessage = firstError || lastErrorMessage;
		if ((firstError ?? "").includes(`Property '${key}' has not been defined`)) {
			continue;
		}
		throw new Error(
			withPsetTroubleshootingHint(
				firstError || "Property set write failed for some items.",
			),
		);
	}

	throw new Error(
		withPsetTroubleshootingHint(
			`${lastErrorMessage} (Tried property keys: ${triedKeys.join(", ")})`,
		),
	);
}

export async function inspectWbsPsetConfig(
	api: WorkspaceApi,
): Promise<WbsPsetDebugInfo> {
	const project = await api.project.getProject();
	if (!project?.id) {
		return {
			ok: false,
			serviceUri: "",
			configuredLibId: "",
			configuredDefinitionName: "",
			configuredPropertyName: "",
			message: "No project selected.",
		};
	}

	const token = await api.extension.requestPermission("accesstoken");
	if (token === "denied" || token === "pending") {
		return {
			ok: false,
			serviceUri: "",
			configuredLibId: "",
			configuredDefinitionName: "",
			configuredPropertyName: "",
			message: `Access token ${token}.`,
		};
	}

	const serviceUri = await resolvePsetServiceUri();
	const configuredLibId = readPsetEnv("PSET_LIB_ID") || DEFAULT_LIBRARY_ID;
	const configuredDefinitionName =
		readPsetEnv("PSET_DEFINITION_NAME") || DEFAULT_DEFINITION_NAME;
	const configuredPropertyName =
		readPsetEnv("PSET_PROPERTY_NAME") || DEFAULT_PROPERTY_NAME;
	const explicitDefId = readPsetEnv("PSET_DEF_ID");

	const libraryNameCandidates = [
		readPsetEnv("PSET_LIBRARY_NAME"),
		DEFAULT_LIBRARY_NAME,
		configuredLibId,
		DEFAULT_LIBRARY_ID,
	].flatMap((s) => (typeof s === "string" && s.trim() ? [s.trim()] : []));

	const pset = new PSet({
		serviceUri,
		credentials: new ServiceCredentials(undefined, token),
	});

	try {
		const { libId, defId } = await resolveCanonicalLibAndDefIds(
			pset,
			project.id,
			serviceUri,
			token,
			configuredLibId,
			libraryNameCandidates,
			configuredDefinitionName,
			explicitDefId,
		);
		const prop = await resolveSchemaPropertyName(
			pset,
			libId,
			defId,
			configuredPropertyName,
			configuredDefinitionName,
		);
		let resolvedLibName: string | undefined;
		let resolvedDefName: string | undefined;
		let resolvedPropertyLabel: string | undefined;
		let availableDefinitions: string[] | undefined;
		try {
			const gl = await pset.getLibrary(libId);
			const lib = gl.data as { name?: string };
			resolvedLibName =
				typeof lib?.name === "string" && lib.name.trim()
					? lib.name.trim()
					: undefined;
		} catch {
			/* best-effort only */
		}
		try {
			const ld = await pset.listDefinitions(libId, { top: 500 });
			const defs =
				(ld.data as { items?: Array<{ id?: string; name?: string }> }).items ?? [];
			const found = defs.find((d) => d.id === defId);
			resolvedDefName =
				typeof found?.name === "string" && found.name.trim()
					? found.name.trim()
					: undefined;
			availableDefinitions = defs
				.map((d) => (typeof d.name === "string" ? d.name.trim() : ""))
				.filter((s) => s.length > 0)
				.slice(0, 30);
		} catch {
			/* best-effort only */
		}
		try {
			const gd = await pset.getDefinition(libId, defId);
			resolvedPropertyLabel = extractPropertyDisplayLabel(gd.data, prop);
		} catch {
			/* best-effort only */
		}
		return {
			ok: true,
			serviceUri,
			configuredLibId,
			configuredDefinitionName,
			configuredPropertyName,
			resolvedLibId: libId,
			resolvedLibName,
			resolvedDefId: defId,
			resolvedDefName,
			resolvedPropertyName: prop,
			resolvedPropertyLabel,
			availableDefinitions,
			message: "PSet config resolved successfully.",
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		let resolvedLibName: string | undefined;
		let availableDefinitions: string[] | undefined;
		try {
			const gl = await pset.getLibrary(configuredLibId);
			const lib = gl.data as { id?: string; name?: string };
			if (typeof lib?.name === "string" && lib.name.trim()) {
				resolvedLibName = lib.name.trim();
			}
			const effectiveLibId =
				typeof lib?.id === "string" && lib.id.trim() ? lib.id.trim() : configuredLibId;
			const ld = await pset.listDefinitions(effectiveLibId, { top: 500 });
			const defs =
				(ld.data as { items?: Array<{ id?: string; name?: string }> }).items ?? [];
			availableDefinitions = defs
				.map((d) => (typeof d.name === "string" ? d.name.trim() : ""))
				.filter((s) => s.length > 0)
				.slice(0, 30);
		} catch {
			/* keep base error */
		}
		return {
			ok: false,
			serviceUri,
			configuredLibId,
			configuredDefinitionName,
			configuredPropertyName,
			resolvedLibName,
			availableDefinitions,
			message: withPsetTroubleshootingHint(msg),
		};
	}
}

export async function loadKnownLibraryLinks(
	api: WorkspaceApi,
): Promise<KnownLibraryLinksResult> {
	const project = await api.project.getProject();
	if (!project?.id) {
		return { links: [], message: "No project selected." };
	}
	const token = await api.extension.requestPermission("accesstoken");
	if (token === "denied" || token === "pending") {
		return { links: [], message: `Access token ${token}.` };
	}

	const serviceUri = await resolvePsetServiceUri();
	const configuredLibId = readPsetEnv("PSET_LIB_ID") || DEFAULT_LIBRARY_ID;
	const definitionName =
		readPsetEnv("PSET_DEFINITION_NAME") || DEFAULT_DEFINITION_NAME;
	const explicitDefId = readPsetEnv("PSET_DEF_ID");
	const libraryNameCandidates = [
		readPsetEnv("PSET_LIBRARY_NAME"),
		DEFAULT_LIBRARY_NAME,
		configuredLibId,
		DEFAULT_LIBRARY_ID,
	].flatMap((s) => (typeof s === "string" && s.trim() ? [s.trim()] : []));

	const pset = new PSet({
		serviceUri,
		credentials: new ServiceCredentials(undefined, token),
	});
	const { libId, defId } = await resolveCanonicalLibAndDefIds(
		pset,
		project.id,
		serviceUri,
		token,
		configuredLibId,
		libraryNameCandidates,
		definitionName,
		explicitDefId,
	);
	const links = new Set<string>();
	const seenNext = new Set<string>();
	let page = await pset.listPSetsByDefinition(libId, defId, { top: 500 });
	for (;;) {
		const items =
			(page.data as { items?: Array<{ link?: string }> })?.items ?? [];
		for (const item of items) {
			if (typeof item?.link === "string" && item.link.trim().startsWith("frn:")) {
				links.add(item.link.trim());
			}
		}
		const next =
			(page.data as { next?: string })?.next ??
			undefined;
		if (!next || seenNext.has(next)) break;
		seenNext.add(next);
		try {
			// SDK exposes raw next-page URL in `next`; follow with authenticated fetch.
			const res = await fetch(next, {
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/json",
				},
			});
			if (!res.ok) break;
			const data = (await res.json()) as unknown;
			page = { ...page, data } as typeof page;
		} catch {
			break;
		}
	}

	return {
		links: [...links],
		message:
			links.size > 0
				? `Loaded ${links.size} known link(s) from PSet listPSetsByDefinition.`
				: "No known links found from PSet listPSetsByDefinition.",
	};
}

function payloadContainsExpectedValueAtProperty(
	root: unknown,
	propertyName: string,
	expectedValue: string,
): boolean {
	const expected = expectedValue.trim().toLowerCase();
	if (!expected) return false;
	let matched = false;
	const walk = (node: unknown, depth: number): void => {
		if (matched || depth > 14 || node == null) return;
		if (Array.isArray(node)) {
			for (const item of node) walk(item, depth + 1);
			return;
		}
		if (typeof node !== "object") return;
		const o = node as Record<string, unknown>;
		const candidate = o[propertyName];
		if (typeof candidate === "string") {
			if (candidate.trim().toLowerCase() === expected) matched = true;
		} else if (typeof candidate === "number" || typeof candidate === "boolean") {
			if (String(candidate).trim().toLowerCase() === expected) matched = true;
		}
		for (const value of Object.values(o)) walk(value, depth + 1);
	};
	walk(root, 0);
	return matched;
}

export async function verifyWbsValueByLink(
	api: WorkspaceApi,
	link: string,
	expectedValue: string,
): Promise<WbsPsetLinkVerificationResult> {
	const normalizedLink = link.trim();
	if (!normalizedLink.startsWith("frn:")) {
		return {
			ok: false,
			foundLink: false,
			matchedValue: false,
			message: "Verification skipped: invalid link.",
		};
	}
	const project = await api.project.getProject();
	if (!project?.id) {
		return {
			ok: false,
			foundLink: false,
			matchedValue: false,
			message: "No project selected.",
		};
	}
	const token = await api.extension.requestPermission("accesstoken");
	if (token === "denied" || token === "pending") {
		return {
			ok: false,
			foundLink: false,
			matchedValue: false,
			message: `Access token ${token}.`,
		};
	}

	try {
		const serviceUri = await resolvePsetServiceUri();
		const configuredLibId = readPsetEnv("PSET_LIB_ID") || DEFAULT_LIBRARY_ID;
		const definitionName =
			readPsetEnv("PSET_DEFINITION_NAME") || DEFAULT_DEFINITION_NAME;
		const explicitDefId = readPsetEnv("PSET_DEF_ID");
		const configuredPropertyName =
			readPsetEnv("PSET_PROPERTY_NAME") || DEFAULT_PROPERTY_NAME;
		const libraryNameCandidates = [
			readPsetEnv("PSET_LIBRARY_NAME"),
			DEFAULT_LIBRARY_NAME,
			configuredLibId,
			DEFAULT_LIBRARY_ID,
		].flatMap((s) => (typeof s === "string" && s.trim() ? [s.trim()] : []));

		const pset = new PSet({
			serviceUri,
			credentials: new ServiceCredentials(undefined, token),
		});
		const { libId, defId } = await resolveCanonicalLibAndDefIds(
			pset,
			project.id,
			serviceUri,
			token,
			configuredLibId,
			libraryNameCandidates,
			definitionName,
			explicitDefId,
		);
		const propertyName = await resolveSchemaPropertyName(
			pset,
			libId,
			defId,
			configuredPropertyName,
			definitionName,
		);

		let foundLink = false;
		let matchedValue = false;
		const seenNext = new Set<string>();
		let page = await pset.listPSetsByDefinition(libId, defId, { top: 500 });
		for (;;) {
			const items =
				(page.data as { items?: Array<{ link?: string; props?: unknown }> })?.items ?? [];
			for (const item of items) {
				const itemLink = item?.link?.trim();
				if (!itemLink || itemLink !== normalizedLink) continue;
				foundLink = true;
				if (
					payloadContainsExpectedValueAtProperty(
						item.props,
						propertyName,
						expectedValue,
					)
				) {
					matchedValue = true;
					break;
				}
			}
			if (matchedValue) break;
			const next = (page.data as { next?: string })?.next ?? undefined;
			if (!next || seenNext.has(next)) break;
			seenNext.add(next);
			try {
				const res = await fetch(next, {
					headers: {
						Authorization: `Bearer ${token}`,
						Accept: "application/json",
					},
				});
				if (!res.ok) break;
				const data = (await res.json()) as unknown;
				page = { ...page, data } as typeof page;
			} catch {
				break;
			}
		}

		return {
			ok: true,
			foundLink,
			matchedValue,
			libId,
			defId,
			propertyName,
			message: matchedValue
				? "Verified written value in PSet API for target link."
				: foundLink
					? "Target link exists in PSet API, but expected value not found yet."
					: "Target link not found in PSet API listPSetsByDefinition.",
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			foundLink: false,
			matchedValue: false,
			message: withPsetTroubleshootingHint(message),
		};
	}
}
