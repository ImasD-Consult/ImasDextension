import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
	notFoundErrorSchema,
	trimbleBatchStatusResponseSchema,
} from "../../lib/schemas";
import { loadTrimbleBatchStatus } from "../../services/trimble-batch.service";

const paramsSchema = z.object({
	jobId: z.string().uuid(),
});

export function registerGetTrimbleBatchStatus(rawApp: FastifyInstance): void {
	const app = rawApp.withTypeProvider<ZodTypeProvider>();
	app.get(
		"/integrations/trimble/batch-qr/jobs/:jobId",
		{
			schema: {
				tags: ["pdf-qr"],
				description: "Poll Trimble batch QR orchestration job status.",
				params: paramsSchema,
				response: {
					200: trimbleBatchStatusResponseSchema,
					404: notFoundErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const { jobId } = request.params;
			const status = await loadTrimbleBatchStatus(request.server, jobId);
			if (!status) {
				return reply.status(404).send({
					error: "not_found",
					message: "Unknown jobId",
				});
			}
			return reply.send(status);
		},
	);
}

