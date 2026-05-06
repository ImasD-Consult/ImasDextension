import type { SmartPrintFeatureCode } from "../licensing/features";

export type LicenceFeature = {
	featureKey: string;
};

type LicenceApiShape = {
	features?: Array<{ featureKey?: string; key?: string; code?: string }>;
	licenseType?: {
		features?: Array<{ featureKey?: string; key?: string; code?: string }>;
	};
};

function extractFeatureCodes(payload: unknown): Set<string> {
	const out = new Set<string>();
	if (!Array.isArray(payload)) return out;
	for (const item of payload as LicenceApiShape[]) {
		const sources = [item.features, item.licenseType?.features];
		for (const source of sources) {
			if (!Array.isArray(source)) continue;
			for (const feature of source) {
				const key = feature.featureKey ?? feature.key ?? feature.code ?? "";
				if (key.trim()) out.add(key.trim().toUpperCase());
			}
		}
	}
	return out;
}

function url(baseUrl: string, userId: string): string {
	const b = baseUrl.replace(/\/+$/, "");
	return `${b}/app/users/licenses?userId=${encodeURIComponent(userId)}`;
}

export async function fetchUserLicenceFeatures(
	baseUrl: string,
	userId: string,
	clientId: string,
): Promise<Set<string>> {
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
	return extractFeatureCodes(payload);
}

export function hasFeature(
	granted: Set<string>,
	feature: SmartPrintFeatureCode,
): boolean {
	return granted.has(feature.toUpperCase());
}
