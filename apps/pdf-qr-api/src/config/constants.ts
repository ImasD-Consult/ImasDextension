/** URL prefix for versioned API routes (e.g. `/v1`). */
export const API_VERSION_PREFIX = "/v1" as const;

export const RATE_LIMIT = {
	max: 120,
	/** Passed to `@fastify/rate-limit` as milliseconds. */
	timeWindowMs: 60_000,
} as const;

export const BULLMQ_DEFAULT_JOB_OPTIONS = {
	attempts: 2,
	backoff: { type: "exponential" as const, delay: 2000 },
} as const;

export const BULLMQ_REMOVE_ON_COMPLETE = { age: 3600, count: 1000 } as const;
export const BULLMQ_REMOVE_ON_FAIL = { age: 86400 } as const;
