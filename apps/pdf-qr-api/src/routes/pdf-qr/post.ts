import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { inputKey } from "../../lib/redis-keys";
import {
	enqueueResponseSchema,
	pdfQrUploadBodySchema,
	validationErrorSchema,
} from "../../lib/schemas";
import {
	buildStampJobLocation,
	bullmqStampJobOptions,
	prepareStampEnqueueWithFileBuffer,
} from "../../services/stamp-job.service";

export function registerPostPdfQr(rawApp: FastifyInstance): void {
	const app = rawApp.withTypeProvider<ZodTypeProvider>();

	app.post(
		"/pdf/qr",
		{
			schema: {
				description:
					"Upload a PDF (`file`) with `qr_text`, `position`, and optional layout fields. Returns `202` with `jobId`.",
				tags: ["pdf-qr"],
				consumes: ["multipart/form-data"],
				body: pdfQrUploadBodySchema,
				response: {
					202: enqueueResponseSchema,
					400: validationErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const env = request.server.env;
			const body = request.body;

			const fileBuffer = await body.file.toBuffer();

			const prepared = prepareStampEnqueueWithFileBuffer(
				body,
				fileBuffer,
				env.MAX_QR_TEXT_LENGTH,
			);
			if ("status" in prepared) {
				return reply.status(prepared.status).send(prepared.body as never);
			}

			const { fileBuffer: buf, payload } = prepared;

			await request.server.redis.setex(
				inputKey(payload.jobId),
				env.JOB_INPUT_TTL_SEC,
				buf,
			);

			await request.server.pdfQrQueue.add("stamp", payload, {
				jobId: payload.jobId,
				...bullmqStampJobOptions(),
			});

			const location = buildStampJobLocation(request, payload.jobId);

			request.log.info(
				{ jobId: payload.jobId, bytes: buf.length },
				"pdf_qr_job_enqueued",
			);

			return reply
				.code(202)
				.header("Location", location)
				.send({ jobId: payload.jobId });
		},
	);
}
