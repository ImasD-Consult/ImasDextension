import type { SmartPrintFeatureCode } from "../licensing/features";
import type { PortalAuthContext } from "./portal-auth";
import type { LicenceEntitlements } from "./license-service";

const activeFeatureSessions = new Set<string>();

function startUrl(baseUrl: string): string {
	return `${baseUrl.replace(/\/+$/, "")}/app/license-sessions/`;
}

function endAllUrl(baseUrl: string, userId: string): string {
	const b = baseUrl.replace(/\/+$/, "");
	return `${b}/app/users/${encodeURIComponent(userId)}/end-sessions`;
}

export async function ensureFeatureSessionStarted(
	auth: PortalAuthContext,
	entitlements: LicenceEntitlements,
	feature: SmartPrintFeatureCode,
): Promise<void> {
	if (activeFeatureSessions.has(feature)) return;
	const licenseTypeId = entitlements.featureToLicenseTypeId.get(feature);
	if (!licenseTypeId) return;
	const response = await fetch(startUrl(auth.baseUrl), {
		method: "POST",
		credentials: "include",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
			"x-client-id": auth.clientId,
		},
		body: JSON.stringify({
			userId: auth.session.userId,
			licenseTypeId,
		}),
	});
	// Keep non-fatal to avoid breaking UX if sessions endpoint is unavailable.
	if (response.ok || response.status === 409 || response.status === 404) {
		activeFeatureSessions.add(feature);
	}
}

export function clearFeatureSessionCache(): void {
	activeFeatureSessions.clear();
}

export async function endAllLicenseSessions(auth: PortalAuthContext): Promise<void> {
	try {
		await fetch(endAllUrl(auth.baseUrl, auth.session.userId), {
			method: "POST",
			credentials: "include",
			headers: {
				Accept: "application/json",
				"x-client-id": auth.clientId,
			},
		});
	} catch {
		// non-fatal on logout
	}
}
