import {
	getPortalAuthHeader,
	getPortalClientId,
	getSmartPrintApiBaseUrl,
} from "./api-context";

function buildHeaders(init?: HeadersInit): Headers {
	const headers = new Headers(init);
	if (!headers.has("Accept")) headers.set("Accept", "application/json");
	const bearer = getPortalAuthHeader();
	if (bearer && !headers.has("Authorization")) {
		headers.set("Authorization", bearer);
	}
	const clientId = getPortalClientId();
	if (clientId && !headers.has("x-client-id")) {
		headers.set("x-client-id", clientId);
	}
	return headers;
}

export async function smartPrintApiFetch(
	path: string,
	init?: RequestInit,
): Promise<Response> {
	const base = getSmartPrintApiBaseUrl();
	const url = `${base}${path}`;
	let response: Response;
	try {
		response = await fetch(url, {
			...init,
			headers: buildHeaders(init?.headers),
		});
	} catch (error) {
		if (error instanceof TypeError) {
			throw new Error(`SmartPrint API unreachable at ${url}.`);
		}
		throw error instanceof Error ? error : new Error("Unexpected API error.");
	}
	if (response.status === 401) {
		throw new Error("Session expired. Please sign in again.");
	}
	return response;
}
