import type { SmartPrintFeatureCode } from "../licensing/features";

export type LicenceFeature = {
	featureKey: string;
};

type LicenceApiShape = {
	licenseTypeId?: string;
	features?: Array<{ featureKey?: string; key?: string; code?: string }>;
	licenseType?: {
		id?: string;
		features?: Array<{ featureKey?: string; key?: string; code?: string }>;
	};
};

export type LicenceEntitlements = {
	features: Set<string>;
	featureToLicenseTypeId: Map<string, string>;
};

function extractEntitlements(payload: unknown): LicenceEntitlements {
	const out = new Set<string>();
	const featureToLicenseTypeId = new Map<string, string>();
	if (!Array.isArray(payload)) return { features: out, featureToLicenseTypeId };
	for (const item of payload as LicenceApiShape[]) {
		const licenseTypeId =
			item.licenseType?.id?.trim() ??
			item.licenseTypeId?.trim() ??
			"";
		const sources = [item.features, item.licenseType?.features];
		for (const source of sources) {
			if (!Array.isArray(source)) continue;
			for (const feature of source) {
				const key = feature.featureKey ?? feature.key ?? feature.code ?? "";
				const normalizedKey = key.trim().toUpperCase();
				if (!normalizedKey) continue;
				out.add(normalizedKey);
				if (licenseTypeId && !featureToLicenseTypeId.has(normalizedKey)) {
					featureToLicenseTypeId.set(normalizedKey, licenseTypeId);
				}
			}
		}
	}
	return { features: out, featureToLicenseTypeId };
}

function url(baseUrl: string, userId: string): string {
	const b = baseUrl.replace(/\/+$/, "");
	return `${b}/app/users/licenses?userId=${encodeURIComponent(userId)}`;
}

export async function fetchUserLicenceFeatures(
	baseUrl: string,
	userId: string,
	clientId: string,
): Promise<LicenceEntitlements> {
	const response = await fetch(url(baseUrl, userId), {
		method: "GET",
		credentials: "include",
		headers: {
			Accept: "application/json",
			"x-client-id": clientId,
		},
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Licence fetch failed (${response.status}): ${body}`);
	}
	const payload = (await response.json()) as unknown;
	return extractEntitlements(payload);
}

export function hasFeature(
	granted: Set<string>,
	feature: SmartPrintFeatureCode,
): boolean {
	return granted.has(feature.toUpperCase());
}
