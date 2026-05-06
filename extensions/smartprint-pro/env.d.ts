/// <reference types="vite/client" />

interface SmartprintProRuntimeEnv {
	readonly EXTENSION_URL?: string;
	readonly TRIMBLE_CONNECT_ORIGIN?: string;
	readonly TRIMBLE_CONNECT_QR_URL_TEMPLATE?: string;
	/** `na` | `eu` | `ap` | `ap2` — matches Trimble `/regions` `serviceRegion` (EU → `eu`). */
	readonly TRIMBLE_CONNECT_REGION?: string;
	readonly PSET_SERVICE_URI?: string;
	readonly PSET_LIB_ID?: string;
	readonly PSET_LIBRARY_NAME?: string;
	readonly PSET_DEFINITION_NAME?: string;
	readonly PSET_DEF_ID?: string;
	readonly PSET_PROPERTY_NAME?: string;
}

declare global {
	interface Window {
		__SMARTPRINT_PRO__?: SmartprintProRuntimeEnv;
	}
}

export {};
