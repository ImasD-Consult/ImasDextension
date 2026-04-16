import { createRedisConnection } from "./infra/redis";
import { loadEnv } from "./lib/env";
import { createRootLogger } from "./lib/logger";
import { createPdfQrWorker } from "./server";

const env = loadEnv();
const log = createRootLogger(env).child({ component: "worker-entry" });

const redis = createRedisConnection(env.REDIS_URL);

const worker = createPdfQrWorker(env, redis);

log.info(
	{ queueConcurrency: env.QUEUE_CONCURRENCY },
	"pdf_qr_worker_started",
);

async function shutdown() {
	log.info("pdf_qr_worker_shutting_down");
	await worker.close();
	await redis.quit();
	process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
