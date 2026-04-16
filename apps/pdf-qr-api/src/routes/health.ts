import type { FastifyPluginAsync } from "fastify";
import type { Redis } from "ioredis";
import { z } from "zod";

const healthRoutes: FastifyPluginAsync<{ redis: Redis }> = async (app, opts) => {
	app.get(
		"/health",
		{
			schema: {
				hide: true,
				response: {
					200: z.object({
						status: z.literal("ok"),
					}),
				},
			},
		},
		async () => ({ status: "ok" as const }),
	);

	app.get(
		"/ready",
		{
			schema: {
				hide: true,
				response: {
					200: z.object({ status: z.literal("ok") }),
					503: z.object({ status: z.literal("unavailable") }),
				},
			},
		},
		async (_request, reply) => {
			try {
				await opts.redis.ping();
				return { status: "ok" as const };
			} catch {
				return reply.status(503).send({ status: "unavailable" as const });
			}
		},
	);
};

export default healthRoutes;
