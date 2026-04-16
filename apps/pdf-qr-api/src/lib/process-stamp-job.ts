import type { Redis } from "ioredis";
import type { Logger } from "pino";
import type { Env } from "./env";
import { stampPdfWithQr } from "./mupdf-stamp";
import { inputKey } from "./redis-keys";
import type { StampJobPayload } from "./schemas";

export async function runStampJob(
	redis: Redis,
	env: Env,
	payload: StampJobPayload,
	log: Logger,
): Promise<{ pdf: Uint8Array; pageCount: number }> {
	const key = inputKey(payload.jobId);
	const buf = await redis.getBuffer(key);
	if (!buf) {
		log.warn({ jobId: payload.jobId }, "stamp job missing input in redis");
		throw new Error("Input PDF missing or expired");
	}

	await redis.del(key);

	const child = log.child({ jobId: payload.jobId });
	child.info("job_processing_start");
	const { pdf, pageCount } = await stampPdfWithQr(buf, payload, {
		maxPages: env.MAX_PDF_PAGES,
	});
	child.info({ bytes: pdf.byteLength, pageCount }, "job_processing_done");
	return { pdf, pageCount };
}
