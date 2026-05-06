import {
	clearPortalSession,
	loadPortalSession,
	savePortalSession,
	type PortalSessionState,
} from "./session-store";

type LoginResponse = {
	token?: string;
	user?: { id?: string; email?: string };
	expiresAt?: string;
};

type SessionResponse = {
	session?: { userId?: string; expiresAt?: string };
	user?: { id?: string; email?: string };
};

type RuntimeEnv = {
	PORTAL_BASE_URL?: string;
	PORTAL_CLIENT_ID?: string;
};

function readRuntimeEnv(): RuntimeEnv {
	if (typeof window === "undefined") return {};
	const w = window as Window & { __SMARTPRINT_PRO__?: RuntimeEnv };
	return w.__SMARTPRINT_PRO__ ?? {};
}

function readEnv(name: "PORTAL_BASE_URL" | "PORTAL_CLIENT_ID"): string | undefined {
	const vite = (
		import.meta as ImportMeta & { env?: Record<string, string | undefined> }
	).env?.[`VITE_${name}`];
	if (vite?.trim()) return vite.trim();
	const rt = readRuntimeEnv()[name];
	if (rt?.trim()) return rt.trim();
	return undefined;
}

function requireEnv(name: "PORTAL_BASE_URL" | "PORTAL_CLIENT_ID"): string {
	const value = readEnv(name);
	if (!value) {
		throw new Error(`Missing ${name}. Configure VITE_${name} or runtime ${name}.`);
	}
	return value;
}

function withBase(baseUrl: string, path: string): string {
	return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function readUserId(session: SessionResponse | null): string {
	return (
		session?.user?.id?.trim() ??
		session?.session?.userId?.trim() ??
		""
	);
}

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
	try {
		return (await response.json()) as T;
	} catch {
		return null;
	}
}

export type PortalAuthContext = {
	baseUrl: string;
	clientId: string;
	session: PortalSessionState;
};

export async function loginPortal(
	email: string,
	password: string,
): Promise<PortalAuthContext> {
	const baseUrl = requireEnv("PORTAL_BASE_URL");
	const clientId = requireEnv("PORTAL_CLIENT_ID");
	const response = await fetch(withBase(baseUrl, "/api/auth/sign-in/email"), {
		method: "POST",
		credentials: "include",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
			"x-client-id": clientId,
		},
		body: JSON.stringify({ email, password }),
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Portal login failed (${response.status}): ${body}`);
	}
	const login = (await parseJsonSafe<LoginResponse>(response)) ?? {};
	const session = await validatePortalSession(baseUrl, clientId);
	if (!session) {
		throw new Error("Portal session was not created after login.");
	}
	const merged: PortalSessionState = {
		...session,
		token: login.token?.trim() || session.token,
		email: session.email || login.user?.email,
		expiresAt: session.expiresAt || login.expiresAt,
	};
	savePortalSession(merged);
	return { baseUrl, clientId, session: merged };
}

export async function validatePortalSession(
	baseUrl?: string,
	clientId?: string,
): Promise<PortalSessionState | null> {
	const resolvedBase = baseUrl ?? readEnv("PORTAL_BASE_URL");
	const resolvedClientId = clientId ?? readEnv("PORTAL_CLIENT_ID");
	if (!resolvedBase || !resolvedClientId) return null;
	const response = await fetch(withBase(resolvedBase, "/api/auth/get-session"), {
		method: "GET",
		credentials: "include",
		headers: {
			Accept: "application/json",
			"x-client-id": resolvedClientId,
		},
	});
	if (response.status === 401) return null;
	if (!response.ok) return null;
	const body = await parseJsonSafe<SessionResponse>(response);
	const userId = readUserId(body);
	if (!userId) return null;
	const session: PortalSessionState = {
		userId,
		email: body?.user?.email,
		expiresAt: body?.session?.expiresAt,
		token: loadPortalSession()?.token,
	};
	savePortalSession(session);
	return session;
}

export async function restorePortalAuth(): Promise<PortalAuthContext | null> {
	const baseUrl = readEnv("PORTAL_BASE_URL");
	const clientId = readEnv("PORTAL_CLIENT_ID");
	if (!baseUrl || !clientId) return null;
	const refreshed = await validatePortalSession(baseUrl, clientId);
	if (!refreshed) {
		clearPortalSession();
		return null;
	}
	const existing = loadPortalSession();
	return {
		baseUrl,
		clientId,
		session: {
			...refreshed,
			token: existing?.token || refreshed.token,
		},
	};
}

export function logoutPortal(): void {
	clearPortalSession();
}
