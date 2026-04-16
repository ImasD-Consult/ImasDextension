import type { Redis } from "ioredis";
import { Queue } from "bullmq";
import {
	BULLMQ_DEFAULT_JOB_OPTIONS,
} from "../config/constants";
import { PDF_QR_QUEUE_NAME } from "../lib/queue-name";
import type { StampJobPayload } from "../lib/schemas";

export function createPdfQrQueue(
	redis: Redis,
): Queue<StampJobPayload, { pageCount: number }> {
	return new Queue<StampJobPayload, { pageCount: number }>(
		PDF_QR_QUEUE_NAME,
		{
			connection: redis.duplicate(),
			defaultJobOptions: { ...BULLMQ_DEFAULT_JOB_OPTIONS },
		},
	);
}
