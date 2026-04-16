import type { MultipartFile } from "@fastify/multipart";
import { z } from "zod";
import { qrPositionSchema } from "./stamp";

function multipartText(desc: string) {
	return z.preprocess((val) => {
		if (val && typeof val === "object" && val !== null && "value" in val) {
			return String((val as { value: unknown }).value ?? "");
		}
		return val == null ? "" : String(val);
	}, z.string().describe(desc));
}

function multipartTextOptional(desc: string) {
	return z.preprocess((val) => {
		if (val === undefined || val === null) return undefined;
		if (typeof val === "object" && val !== null && "value" in val) {
			const s = String((val as { value: unknown }).value ?? "");
			return s === "" ? undefined : s;
		}
		const s = String(val);
		return s === "" ? undefined : s;
	}, z.string().optional().describe(desc));
}

const pdfFileFieldSchema = z
	.custom<MultipartFile>(
		(v): v is MultipartFile =>
			typeof v === "object" &&
			v !== null &&
			"mimetype" in v &&
			typeof (v as MultipartFile).toBuffer === "function",
	)
	.describe("PDF upload (`field` name must be `file`)")
	.refine((f) => Boolean((f as MultipartFile).file), {
		message: "Missing PDF file field `file`",
	})
	.refine(
		(f) => {
			const file = f as MultipartFile;
			const mt = file.mimetype?.toLowerCase() ?? "";
			const fn = file.filename?.toLowerCase() ?? "";
			return (
				mt === "application/pdf" ||
				mt.includes("pdf") ||
				fn.endsWith(".pdf")
			);
		},
		{ message: "Only PDF uploads are allowed" },
	);

/**
 * Multipart form for `POST /v1/pdf/qr`.
 * Used with `@fastify/multipart` `attachFieldsToBody: true` (field wrapper objects).
 */
export const pdfQrUploadBodySchema = z
	.object({
		file: pdfFileFieldSchema,
		qr_text: multipartText("Text encoded in the QR code.").pipe(
			z.string().min(1),
		),
		position: multipartText(
			"Anchor: bottom-left | bottom-right | center | top-left | top-right.",
		).pipe(qrPositionSchema),
		margin_pt: multipartTextOptional(
			"Optional margin from the anchor edge in points (0–200).",
		),
		layout_mode: multipartTextOptional("Layout mode: inset | override."),
		offset_x_pt: multipartTextOptional(
			"Horizontal offset in points (default 0).",
		),
		offset_y_pt: multipartTextOptional(
			"Vertical offset in points (default 0).",
		),
		qr_size_pt: multipartTextOptional(
			"QR square size in points (default 72, min 24, max 200).",
		),
	})
	.describe(
		"Multipart form fields for stamping. Send as `multipart/form-data` with a PDF file field named `file`.",
	);

export type PdfQrUploadBody = z.infer<typeof pdfQrUploadBodySchema>;
