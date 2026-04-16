import pino from "pino";
import type { Env } from "./env";

export function createRootLogger(env: Env) {
	return pino({
		level: env.LOG_LEVEL,
		redact: {
			paths: ["req.headers.authorization", "headers.authorization"],
			remove: true,
		},
	});
}
