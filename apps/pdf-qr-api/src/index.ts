import type { Worker } from "bullmq";
import { loadEnv } from "./lib/env";
import { buildServer, createPdfQrWorker } from "./server";

const env = loadEnv();

async function main() {
	const { app, redis } = await buildServer(env);

	let inlineWorker: Worker | undefined;
	if (env.RUN_WORKER_IN_PROCESS) {
		inlineWorker = createPdfQrWorker(env, redis);
		app.log.info("BullMQ worker running in-process");
		app.addHook("onClose", async () => {
			await inlineWorker?.close();
		});
	}

	await app.listen({ port: env.PORT, host: env.HOST });
	app.log.info({ port: env.PORT, host: env.HOST }, "pdf_qr_api_listening");

	const shutdown = async () => {
		await app.close();
		process.exit(0);
	};

	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
