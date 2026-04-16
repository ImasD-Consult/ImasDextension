import { z } from "zod";

export const simpleErrorSchema = z.object({
	error: z.string().describe("Machine-readable error code"),
	message: z.string().describe("Human-readable message"),
});

export const validationErrorSchema = simpleErrorSchema.extend({
	details: z
		.unknown()
		.optional()
		.describe(
			"Zod / validation details when `error` is `validation_error`",
		),
});

export const notFoundErrorSchema = z.object({
	error: z.literal("not_found"),
	message: z.string(),
});

export const jobFailedErrorSchema = z.object({
	error: z.literal("job_failed"),
	message: z.string(),
});

export const goneErrorSchema = z.object({
	error: z.literal("gone"),
	message: z.string(),
});

export const notReadyErrorSchema = z.object({
	error: z.literal("not_ready"),
	message: z.string(),
});

/** `GET .../result` when the job is unknown or not finished yet (HTTP 404). */
export const resultDownload404Schema = z.object({
	error: z.enum(["not_found", "not_ready"]),
	message: z.string(),
});
