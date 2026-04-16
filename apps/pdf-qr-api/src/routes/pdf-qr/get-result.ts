import type { Job } from "bullmq";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
	goneErrorSchema,
	jobFailedErrorSchema,
	jobIdParamsSchema,
	resultDownload404Schema,
} from "../../lib/schemas";
import type { StampJobPayload } from "../../lib/schemas";
import { outputKey } from "../../lib/redis-keys";

export function registerGetJobResult(rawApp: FastifyInstance): void {
	const app = rawApp.withTypeProvider<ZodTypeProvider>();

	app.get(
		"/pdf/qr/jobs/:jobId/result",
		{
			schema: {
				description:
					"Download the stamped PDF once. Response body is raw PDF; the stored result is deleted after a successful download.",
				tags: ["pdf-qr"],
				produces: ["application/pdf"],
				params: jobIdParamsSchema,
				response: {
					200: z
						.any()
						.describe(
							"Stamped PDF binary (`Content-Type: application/pdf`). Not JSON.",
						),
					400: jobFailedErrorSchema,
					404: resultDownload404Schema.describe(
						"Unknown job id, or job still running",
					),
					410: goneErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const { jobId } = request.params;
			const redis = request.server.redis;
			const outKey = outputKey(jobId);
			const pdf = await redis.getBuffer(outKey);

			if (pdf?.length) {
				await redis.del(outKey);
				request.log.info(
					{ jobId, bytes: pdf.length },
					"pdf_qr_result_delivered",
				);
				return reply
					.type("application/pdf")
					.header(
						"Content-Disposition",
						`attachment; filename="stamped-${jobId}.pdf"`,
					)
					.send(pdf);
			}

			const job = (await request.server.pdfQrQueue.getJob(
				jobId,
			)) as Job<StampJobPayload> | undefined;
			if (!job) {
				return reply.status(404).send({
					error: "not_found",
					message: "Unknown jobId",
				});
			}

			const state = await job.getState();
			if (state === "failed") {
				return reply.status(400).send({
					error: "job_failed",
					message: job.failedReason ?? "Job failed",
				});
			}
			if (state === "completed") {
				return reply.status(410).send({
					error: "gone",
					message: "Result expired or already downloaded",
				});
			}

			return reply.status(404).send({
				error: "not_ready",
				message: "Job is not finished yet",
			});
		},
	);
}
