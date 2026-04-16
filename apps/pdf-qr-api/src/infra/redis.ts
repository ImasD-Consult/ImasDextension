import { Redis } from "ioredis";

const REDIS_CLIENT_OPTIONS = {
	maxRetriesPerRequest: null,
} as const;

export function createRedisConnection(url: string): Redis {
	return new Redis(url, { ...REDIS_CLIENT_OPTIONS });
}
