import sensible from "@fastify/sensible";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import {
	type ZodTypeProvider,
	serializerCompiler,
	validatorCompiler,
} from "fastify-type-provider-zod";
import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { API_VERSION_PREFIX, RATE_LIMIT } from "./config/constants";
import { createPdfQrQueue } from "./infra/pdf-qr-queue";
import { createRedisConnection } from "./infra/redis";
import type { Env } from "./lib/env";
import { createRootLogger } from "./lib/logger";
import { runStampJob } from "./lib/process-stamp-job";
import { outputKey } from "./lib/redis-keys";
import type { StampJobPayload } from "./lib/schemas";
import docsPlugin from "./plugins/docs";
import errorHandlerPlugin from "./plugins/error-handler";
import healthRoutes from "./routes/health";
import pdfQrRoutes from "./routes/pdf-qr";
import { PDF_QR_QUEUE_NAME } from "./lib/queue-name";

export async function buildServer(env: Env) {
	const logger = createRootLogger(env);
	const app = Fastify({
		loggerInstance: logger,
		genReqId: () => randomUUID(),
		requestIdLogLabel: "reqId",
	}).withTypeProvider<ZodTypeProvider>();

	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);

	const redis = createRedisConnection(env.REDIS_URL);
	const pdfQrQueue = createPdfQrQueue(redis);

	await app.register(sensible);
	await app.register(errorHandlerPlugin);
	await app.register(rateLimit, {
		max: RATE_LIMIT.max,
		timeWindow: RATE_LIMIT.timeWindowMs,
	});

	await app.register(multipart, {
		attachFieldsToBody: true,
		limits: {
			fileSize: env.MAX_UPLOAD_BYTES,
			files: 1,
		},
	});

	await app.register(healthRoutes, { redis });

	// Swagger hooks into `onRoute` on this instance; routes on sibling encapsulated
	// scopes are invisible. Register docs at the root so `/v1/*` is included.
	await app.register(docsPlugin);

	app.decorate("env", env);
	app.decorate("redis", redis);
	app.decorate("pdfQrQueue", pdfQrQueue);
	await app.register(pdfQrRoutes, { prefix: API_VERSION_PREFIX });

	app.addHook("onClose", async () => {
		await pdfQrQueue.close();
		await redis.quit();
	});

	app.addHook("onResponse", (request, reply, done) => {
		request.log.info(
			{
				reqId: request.id,
				method: request.method,
				url: request.url,
				statusCode: reply.statusCode,
				responseTime: reply.elapsedTime,
			},
			"request_complete",
		);
		done();
	});

	return { app, redis, pdfQrQueue };
}

export function createPdfQrWorker(env: Env, redis: Redis) {
	const log = createRootLogger(env).child({ component: "worker" });
	const connection = redis.duplicate();

	const worker = new Worker<StampJobPayload, { pageCount: number }>(
		PDF_QR_QUEUE_NAME,
		async (job) => {
			const jobLog = log.child({ jobId: job.id });
			jobLog.info({ name: job.name }, "job_received");
			const { pdf, pageCount } = await runStampJob(
				redis,
				env,
				job.data,
				jobLog,
			);
			await redis.setex(
				outputKey(job.id as string),
				env.JOB_RESULT_TTL_SEC,
				Buffer.from(pdf),
			);
			jobLog.info({ pageCount }, "job_result_stored");
			return { pageCount };
		},
		{
			connection,
			concurrency: env.QUEUE_CONCURRENCY,
		},
	);

	worker.on("failed", (job, err) => {
		log.error(
			{ jobId: job?.id, err },
			job ? "job_failed" : "worker_job_failed",
		);
	});

	return worker;
}
