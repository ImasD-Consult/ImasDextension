import type { FastifyPluginAsync } from "fastify";
import { registerGetJobResult } from "./get-result";
import { registerGetJobStatus } from "./get-status";
import { registerPostPdfQr } from "./post";

const pdfQrRoutes: FastifyPluginAsync = async (rawApp) => {
	registerPostPdfQr(rawApp);
	registerGetJobStatus(rawApp);
	registerGetJobResult(rawApp);
};

export default pdfQrRoutes;
