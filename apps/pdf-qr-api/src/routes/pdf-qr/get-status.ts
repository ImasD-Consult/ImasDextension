import type { Job } from "bullmq";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
	jobIdParamsSchema,
	jobStatusResponseSchema,
	notFoundErrorSchema,
} from "../../lib/schemas";
import type { StampJobPayload } from "../../lib/schemas";

export function registerGetJobStatus(rawApp: FastifyInstance): void {
	const app = rawApp.withTypeProvider<ZodTypeProvider>();

	app.get(
		"/pdf/qr/jobs/:jobId",
		{
			schema: {
				description: "Poll stamping job status.",
				tags: ["pdf-qr"],
				params: jobIdParamsSchema,
				response: {
					200: jobStatusResponseSchema,
					404: notFoundErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const { jobId } = request.params;
			const job = (await request.server.pdfQrQueue.getJob(
				jobId,
			)) as Job<StampJobPayload> | undefined;
			if (!job) {
				return reply.status(404).send({
					error: "not_found",
					message: "Unknown jobId",
				});
			}

			const status = await job.getState();
			const pageCount =
				typeof job.returnvalue === "object" &&
				job.returnvalue !== null &&
				"pageCount" in job.returnvalue
					? Number((job.returnvalue as { pageCount: number }).pageCount)
					: null;

			return reply.send({
				jobId,
				status,
				createdAt: job.timestamp ?? null,
				startedAt: job.processedOn ?? null,
				finishedAt: job.finishedOn ?? null,
				pageCount,
				error: job.failedReason ?? null,
			});
		},
	);
}
