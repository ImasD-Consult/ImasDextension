import { z } from "zod";

export const qrPositionSchema = z.enum([
	"bottom-left",
	"bottom-right",
	"center",
	"top-left",
	"top-right",
]);

export type QrPosition = z.infer<typeof qrPositionSchema>;

export const layoutModeSchema = z.enum(["inset", "override"]);

/** Max QR text length is enforced at runtime via `Env.MAX_QR_TEXT_LENGTH`. */
export const stampOptionsSchema = z.object({
	qrText: z
		.string()
		.min(1)
		.describe(
			"Text encoded in the QR code (maximum length is enforced by the server)",
		),
	position: qrPositionSchema.describe("Where the QR is anchored on the page"),
	marginPt: z
		.number()
		.min(0)
		.max(200)
		.optional()
		.describe("Margin from the anchor edge, in typographic points"),
	layoutMode: layoutModeSchema
		.optional()
		.default("inset")
		.describe("How the QR interacts with existing page content"),
	offsetXPt: z
		.number()
		.min(-500)
		.max(500)
		.optional()
		.default(0)
		.describe("Horizontal offset from the anchor, in points"),
	offsetYPt: z
		.number()
		.min(-500)
		.max(500)
		.optional()
		.default(0)
		.describe("Vertical offset from the anchor, in points"),
	qrSizePt: z
		.number()
		.min(24)
		.max(200)
		.optional()
		.default(72)
		.describe("QR code square size in typographic points"),
});

export type StampOptions = z.infer<typeof stampOptionsSchema>;

export const stampJobPayloadSchema = stampOptionsSchema.extend({
	jobId: z.string().uuid(),
});

export type StampJobPayload = z.infer<typeof stampJobPayloadSchema>;
