/// <reference types="vite/client" />

interface SmartprintProRuntimeEnv {
	readonly EXTENSION_URL?: string;
	readonly TRIMBLE_CONNECT_ORIGIN?: string;
	/** `na` | `eu` | `ap` | `ap2` — matches Trimble `/regions` `serviceRegion` (EU → `eu`). */
	readonly TRIMBLE_CONNECT_REGION?: string;
}

declare global {
	interface Window {
		__SMARTPRINT_PRO__?: SmartprintProRuntimeEnv;
	}
}

export {};
