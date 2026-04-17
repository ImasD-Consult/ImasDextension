import type { FastifyPluginAsync } from "fastify";
import { registerGetJobResult } from "./get-result";
import { registerGetJobStatus } from "./get-status";
import { registerGetTrimbleBatchStatus } from "./get-trimble-batch-status";
import { registerPostPdfQr } from "./post";
import { registerPostTrimbleBatch } from "./post-trimble-batch";
import { registerPostVersionUpload } from "./post-version-upload";

const pdfQrRoutes: FastifyPluginAsync = async (rawApp) => {
	registerPostPdfQr(rawApp);
	registerPostTrimbleBatch(rawApp);
	registerPostVersionUpload(rawApp);
	registerGetJobStatus(rawApp);
	registerGetJobResult(rawApp);
	registerGetTrimbleBatchStatus(rawApp);
};

export default pdfQrRoutes;
