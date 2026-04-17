import type {
	FastifyError,
	FastifyPluginAsync,
	FastifyReply,
	FastifyRequest,
} from "fastify";
import fp from "fastify-plugin";

function isFastifyError(err: unknown): err is FastifyError {
	return typeof err === "object" && err !== null && "statusCode" in err;
}

const errorHandlerPlugin: FastifyPluginAsync = async (app) => {
	app.setErrorHandler(
		(err: unknown, request: FastifyRequest, reply: FastifyReply) => {
			const safeError = isFastifyError(err) ? err : undefined;

			const statusCode = safeError?.statusCode ?? 500;
			const isServerError = statusCode >= 500;

			const logPayload = {
				err,
				statusCode,
				route: request.routeOptions?.url,
				method: request.method,
			};

			if (isServerError) {
				request.log.error(logPayload, "request failed");
			} else {
				request.log.warn(logPayload, "request failed");
			}

			if (isServerError) {
				const routeUrl = request.routeOptions?.url ?? request.url;
				const trimbleIntegration =
					/\/integrations\/trimble\//.test(routeUrl);
				const message =
					trimbleIntegration && err instanceof Error
						? err.message
						: "An unexpected error occurred";
				return reply.status(statusCode).send({
					error: "internal_error",
					message,
				});
			}

			return reply.status(statusCode).send({
				error: safeError?.code ?? "error",
				message: safeError?.message ?? "Request failed",
			});
		},
	);
};

export default fp(errorHandlerPlugin, { name: "error-handler" });
