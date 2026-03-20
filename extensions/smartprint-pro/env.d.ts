/// <reference types="vite/client" />

interface SmartprintProRuntimeEnv {
	readonly EXTENSION_URL?: string;
}

declare global {
	interface Window {
		__SMARTPRINT_PRO__?: SmartprintProRuntimeEnv;
	}
}

export {};
