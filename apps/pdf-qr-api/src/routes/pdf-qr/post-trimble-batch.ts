import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
	simpleErrorSchema,
	trimbleBatchRequestSchema,
	trimbleBatchStartResponseSchema,
	validationErrorSchema,
} from "../../lib/schemas";
import { startTrimbleBatchJob } from "../../services/trimble-batch.service";

export function registerPostTrimbleBatch(rawApp: FastifyInstance): void {
	const app = rawApp.withTypeProvider<ZodTypeProvider>();
	app.post(
		"/integrations/trimble/batch-qr/jobs",
		{
			schema: {
				tags: ["pdf-qr"],
				description:
					"Server-side orchestration: download Trimble PDFs, stamp QR, upload to QR subfolder.",
				body: trimbleBatchRequestSchema,
				response: {
					202: trimbleBatchStartResponseSchema,
					400: validationErrorSchema,
					500: simpleErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const parsed = trimbleBatchRequestSchema.safeParse(request.body);
			if (!parsed.success) {
				return reply.status(400).send({
					error: "validation_error",
					message: "Invalid request payload",
					details: parsed.error.flatten(),
				});
			}
			try {
				const out = await startTrimbleBatchJob(
					request.server,
					request.server.env,
					parsed.data,
				);
				return reply.status(202).send(out);
			} catch (error) {
				request.log.error({ err: error }, "trimble_batch_start_failed");
				return reply.status(500).send({
					error: "internal_error",
					message:
						error instanceof Error
							? error.message
							: "Failed to start Trimble batch job",
				});
			}
		},
	);
}

