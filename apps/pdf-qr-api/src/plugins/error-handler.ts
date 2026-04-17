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

function extractThrownMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (typeof err === "string") return err;
	if (typeof err === "object" && err !== null && "message" in err) {
		const m = (err as { message: unknown }).message;
		if (typeof m === "string") return m;
	}
	try {
		return String(err);
	} catch {
		return "An unexpected error occurred";
	}
}

function isTrimbleIntegrationRoute(request: FastifyRequest): boolean {
	const path =
		request.url ??
		(request.routeOptions as { url?: string } | undefined)?.url ??
		"";
	return /\/integrations\/trimble(\/|$)/i.test(path);
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
				const trimbleIntegration = isTrimbleIntegrationRoute(request);
				const message = trimbleIntegration
					? extractThrownMessage(err)
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
