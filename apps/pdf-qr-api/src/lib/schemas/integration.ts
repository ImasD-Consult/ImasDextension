import { z } from "zod";
import { layoutModeSchema, qrPositionSchema } from "./stamp";

export const trimbleBatchItemSchema = z.object({
	pdfFileId: z.string().min(1),
	pdfFileName: z.string().min(1),
	qrText: z.string().min(1),
});

export const trimbleBatchRequestSchema = z.object({
	trimble: z.object({
		projectId: z.string().min(1),
		accessToken: z.string().min(1),
		pdfParentFolderId: z.string().min(1),
		outputSubfolderName: z.string().min(1).default("QR"),
		host: z.string().url().optional(),
	}),
	stamp: z.object({
		baseUrl: z.string().url().optional(),
		position: qrPositionSchema.default("bottom-right"),
		marginPt: z.number().min(0).max(200).optional(),
		layoutMode: layoutModeSchema.default("inset"),
		offsetXPt: z.number().min(-500).max(500).default(0),
		offsetYPt: z.number().min(-500).max(500).default(0),
		qrSizePt: z.number().min(24).max(200).default(72),
	}),
	items: z.array(trimbleBatchItemSchema).min(1),
});

export type TrimbleBatchRequest = z.infer<typeof trimbleBatchRequestSchema>;

export const trimbleBatchStartResponseSchema = z.object({
	jobId: z.string().uuid(),
	status: z.enum(["queued", "running", "completed", "failed"]).default("queued"),
});

export const trimbleBatchStatusResponseSchema = z.object({
	jobId: z.string().uuid(),
	status: z.enum(["queued", "running", "completed", "failed"]),
	progress: z.object({
		done: z.number().int().nonnegative(),
		total: z.number().int().nonnegative(),
	}),
	startedAt: z.number().nullable(),
	finishedAt: z.number().nullable(),
	error: z.string().nullable().optional(),
	results: z
		.array(
			z.object({
				pdfFileId: z.string(),
				ok: z.boolean(),
				outputFileId: z.string().nullable(),
				message: z.string().nullable().optional(),
			}),
		)
		.default([]),
});

export type TrimbleBatchStatusResponse = z.infer<
	typeof trimbleBatchStatusResponseSchema
>;

