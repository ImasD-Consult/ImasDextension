export type PortalSessionState = {
	userId: string;
	email?: string;
	token?: string;
	expiresAt?: string;
};

const STORAGE_KEY = "smartprintPro.portalSession.v1";

export function loadPortalSession(): PortalSessionState | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as PortalSessionState;
		if (!parsed?.userId?.trim()) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function savePortalSession(session: PortalSessionState): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
	} catch {
		// ignore storage errors
	}
}

export function clearPortalSession(): void {
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		// ignore storage errors
	}
}
