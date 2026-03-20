/** Values set by `/env.js` before the module bundle runs (see `public/env.js`). */

function trimTrailingSlash(s: string): string {
	return s.replace(/\/+$/, "");
}

export function getRuntimeExtensionUrl(): string | undefined {
	const raw = window.__SMARTPRINT_PRO__?.EXTENSION_URL?.trim();
	if (!raw) return undefined;
	return trimTrailingSlash(raw);
}
