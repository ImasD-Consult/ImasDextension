import { FEATURE_LABEL, type SmartPrintFeatureCode } from "../licensing/features";
import {
	fetchUserLicenceFeatures,
	hasFeature,
} from "./license-service";
import {
	loginPortal,
	logoutPortal,
	restorePortalAuth,
	type PortalAuthContext,
} from "./portal-auth";

type RuntimeEnv = {
	SMARTPRINT_API_BASE_URL?: string;
};

function readRuntimeEnv(): RuntimeEnv {
	if (typeof window === "undefined") return {};
	const w = window as Window & { __SMARTPRINT_PRO__?: RuntimeEnv };
	return w.__SMARTPRINT_PRO__ ?? {};
}

function readSmartPrintApiBaseUrl(): string {
	const vite = (
		import.meta as ImportMeta & { env?: Record<string, string | undefined> }
	).env?.VITE_SMARTPRINT_API_BASE_URL;
	if (vite?.trim()) return vite.trim();
	const rt = readRuntimeEnv().SMARTPRINT_API_BASE_URL;
	if (rt?.trim()) return rt.trim();
	return "https://stamp.imasd.dev";
}

export type AuthLicenseState = {
	auth: PortalAuthContext;
	features: Set<string>;
};

let currentState: AuthLicenseState | null = null;

async function resolveFeatures(auth: PortalAuthContext): Promise<Set<string>> {
	return fetchUserLicenceFeatures(
		auth.baseUrl,
		auth.session.userId,
		auth.clientId,
	);
}

export async function restoreAuthLicenseState(): Promise<AuthLicenseState | null> {
	const auth = await restorePortalAuth();
	if (!auth) return null;
	const features = await resolveFeatures(auth);
	currentState = { auth, features };
	return currentState;
}

export async function loginAndLoadLicences(
	email: string,
	password: string,
): Promise<AuthLicenseState> {
	const auth = await loginPortal(email, password);
	const features = await resolveFeatures(auth);
	currentState = { auth, features };
	return currentState;
}

export function clearAuthLicenseState(): void {
	currentState = null;
	logoutPortal();
}

export function getAuthLicenseState(): AuthLicenseState | null {
	return currentState;
}

export function requireFeature(feature: SmartPrintFeatureCode): void {
	const state = getAuthLicenseState();
	if (!state) throw new Error("Please sign in to ImasD Portal first.");
	if (!hasFeature(state.features, feature)) {
		throw new Error(`Feature not licensed: ${FEATURE_LABEL[feature]}.`);
	}
}

export function getPortalAuthHeader(): string | null {
	const token = currentState?.auth.session.token?.trim();
	return token ? `Bearer ${token}` : null;
}

export function getSmartPrintApiBaseUrl(): string {
	return readSmartPrintApiBaseUrl().replace(/\/+$/, "");
}

export function getPortalClientId(): string {
	const id = currentState?.auth.clientId?.trim();
	return id ?? "";
}
