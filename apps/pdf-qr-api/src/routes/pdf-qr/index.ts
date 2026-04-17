import type { FastifyPluginAsync } from "fastify";
import { registerGetJobResult } from "./get-result";
import { registerGetJobStatus } from "./get-status";
import { registerPostPdfQr } from "./post";
import { registerPostVersionUpload } from "./post-version-upload";

const pdfQrRoutes: FastifyPluginAsync = async (rawApp) => {
	registerPostPdfQr(rawApp);
	registerPostVersionUpload(rawApp);
	registerGetJobStatus(rawApp);
	registerGetJobResult(rawApp);
};

export default pdfQrRoutes;
