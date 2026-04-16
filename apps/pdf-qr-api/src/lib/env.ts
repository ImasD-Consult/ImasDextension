import { z } from "zod";

const envSchema = z.object({
	NODE_ENV: z.string().optional(),
	PORT: z.coerce.number().default(4050),
	HOST: z.string().default("0.0.0.0"),
	LOG_LEVEL: z
		.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
		.default("info"),
	REDIS_URL: z.string().min(1),
	MAX_UPLOAD_BYTES: z.coerce.number().positive().default(25 * 1024 * 1024),
	MAX_PDF_PAGES: z.coerce.number().positive().default(200),
	MAX_QR_TEXT_LENGTH: z.coerce.number().positive().default(2048),
	JOB_INPUT_TTL_SEC: z.coerce.number().positive().default(300),
	JOB_RESULT_TTL_SEC: z.coerce.number().positive().default(300),
	QUEUE_CONCURRENCY: z.coerce.number().positive().default(2),
	RUN_WORKER_IN_PROCESS: z
		.string()
		.optional()
		.transform((v) => v === "true" || v === "1"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
	const parsed = envSchema.safeParse(process.env);
	if (!parsed.success) {
		const msg = parsed.error.flatten().fieldErrors;
		throw new Error(`Invalid environment: ${JSON.stringify(msg)}`);
	}
	return parsed.data;
}
