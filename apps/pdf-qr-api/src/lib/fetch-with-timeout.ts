/**
 * Bounded fetch for outbound Trimble/proxy calls so the API responds before
 * Cloudflare/nginx ~100s origin limits and returns JSON+CORS instead of 502 HTML.
 */
export async function fetchWithTimeout(
	input: RequestInfo | URL,
	init: RequestInit | undefined,
	timeoutMs: number,
): Promise<Response> {
	const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
	if (init?.signal) signals.push(init.signal);
	return fetch(input, {
		...init,
		signal: AbortSignal.any(signals),
	});
}
