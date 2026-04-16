import { z } from "zod";

export const jobStatusResponseSchema = z.object({
	jobId: z.string().uuid().describe("Job identifier"),
	status: z
		.string()
		.describe(
			"BullMQ job state (e.g. waiting, active, completed, failed)",
		),
	createdAt: z.number().nullable().describe("Unix ms when the job was created"),
	startedAt: z.number().nullable().describe("Unix ms when processing started"),
	finishedAt: z.number().nullable().describe("Unix ms when the job finished"),
	pageCount: z
		.number()
		.int()
		.nonnegative()
		.nullable()
		.optional()
		.describe("Number of pages in the PDF when known"),
	error: z
		.string()
		.nullable()
		.optional()
		.describe("Failure reason when status is failed"),
});

export type JobStatusResponse = z.infer<typeof jobStatusResponseSchema>;

export const enqueueResponseSchema = z.object({
	jobId: z
		.string()
		.uuid()
		.describe("Use this id to poll `/v1/pdf/qr/jobs/{jobId}`"),
});

export type EnqueueResponse = z.infer<typeof enqueueResponseSchema>;

export const jobIdParamsSchema = z.object({
	jobId: z.string().uuid().describe("Job id returned from `POST /v1/pdf/qr`"),
});

export type JobIdParams = z.infer<typeof jobIdParamsSchema>;
