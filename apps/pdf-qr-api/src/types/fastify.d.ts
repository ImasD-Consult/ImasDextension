import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { Env } from "../lib/env";
import type { StampJobPayload } from "../lib/schemas";

declare module "fastify" {
	interface FastifyInstance {
		env: Env;
		redis: Redis;
		pdfQrQueue: Queue<StampJobPayload, { pageCount: number }>;
	}
}
