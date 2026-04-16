/** Values set by `/env.js` before the module bundle runs (see `public/env.js`). */

function trimTrailingSlash(s: string): string {
	return s.replace(/\/+$/, "");
}

export function getRuntimeExtensionUrl(): string | undefined {
	const raw = window.__SMARTPRINT_PRO__?.EXTENSION_URL?.trim();
	if (!raw) return undefined;
	return trimTrailingSlash(raw);
}

export function getRuntimeTrimbleConnectOrigin(): string | undefined {
	const raw = window.__SMARTPRINT_PRO__?.TRIMBLE_CONNECT_ORIGIN?.trim();
	if (!raw) return undefined;
	return trimTrailingSlash(raw);
}

/**
 * Optional URL template for QR targets.
 * Supported placeholders:
 * {origin} {modelId} {modelVersionId} {partId} {partLink}
 */
export function getRuntimeQrUrlTemplate(): string | undefined {
	const raw = window.__SMARTPRINT_PRO__?.TRIMBLE_CONNECT_QR_URL_TEMPLATE?.trim();
	return raw || undefined;
}
