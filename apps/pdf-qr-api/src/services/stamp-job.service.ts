import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import {
	API_VERSION_PREFIX,
	BULLMQ_REMOVE_ON_COMPLETE,
	BULLMQ_REMOVE_ON_FAIL,
} from "../config/constants";
import { stampOptionsSchema } from "../lib/schemas";
import type { PdfQrUploadBody, StampJobPayload } from "../lib/schemas";

export function buildStampJobLocation(
	request: FastifyRequest,
	jobId: string,
): string {
	const host = request.headers.host ?? request.hostname;
	return `${request.protocol}://${host}${API_VERSION_PREFIX}/pdf/qr/jobs/${jobId}`;
}

function optNum(s: string | undefined): number | undefined {
	if (s === undefined || s === "") return undefined;
	const n = Number(s);
	return Number.isFinite(n) ? n : Number.NaN;
}

export type PrepareEnqueueFailure = {
	status: 400;
	body: Record<string, unknown>;
};

export type PrepareEnqueueSuccess = {
	fileBuffer: Buffer;
	payload: StampJobPayload;
};

/**
 * Validates multipart fields and PDF bytes; returns a BullMQ payload or a 400 response body.
 */
export function prepareStampEnqueueWithFileBuffer(
	body: PdfQrUploadBody,
	fileBuffer: Buffer,
	maxQrTextLength: number,
): PrepareEnqueueFailure | PrepareEnqueueSuccess {
	if (!fileBuffer?.length) {
		return {
			status: 400,
			body: {
				error: "bad_request",
				message: "Missing PDF file field `file`",
			},
		};
	}

	const head = fileBuffer.subarray(0, 5).toString("latin1");
	if (!head.startsWith("%PDF-")) {
		return {
			status: 400,
			body: {
				error: "bad_request",
				message: "Invalid PDF (missing %PDF- header)",
			},
		};
	}

	const rawOpts = {
		qrText: body.qr_text,
		position: body.position,
		marginPt: optNum(body.margin_pt),
		layoutMode: body.layout_mode || undefined,
		offsetXPt: optNum(body.offset_x_pt),
		offsetYPt: optNum(body.offset_y_pt),
		qrSizePt: optNum(body.qr_size_pt),
	};

	if (
		(rawOpts.marginPt !== undefined && Number.isNaN(rawOpts.marginPt)) ||
		(rawOpts.offsetXPt !== undefined && Number.isNaN(rawOpts.offsetXPt)) ||
		(rawOpts.offsetYPt !== undefined && Number.isNaN(rawOpts.offsetYPt)) ||
		(rawOpts.qrSizePt !== undefined && Number.isNaN(rawOpts.qrSizePt))
	) {
		return {
			status: 400,
			body: {
				error: "bad_request",
				message: "Invalid numeric optional fields",
			},
		};
	}

	const parsedFields = stampOptionsSchema.safeParse({
		...rawOpts,
		offsetXPt: rawOpts.offsetXPt ?? 0,
		offsetYPt: rawOpts.offsetYPt ?? 0,
		qrSizePt: rawOpts.qrSizePt ?? 72,
	});

	if (!parsedFields.success) {
		return {
			status: 400,
			body: {
				error: "validation_error",
				message: "Invalid form fields",
				details: parsedFields.error.flatten(),
			},
		};
	}

	if (parsedFields.data.qrText.length > maxQrTextLength) {
		return {
			status: 400,
			body: {
				error: "bad_request",
				message: `qr_text exceeds max length (${maxQrTextLength})`,
			},
		};
	}

	const jobId = randomUUID();
	const payload: StampJobPayload = {
		jobId,
		...parsedFields.data,
	};

	return { fileBuffer, payload };
}

export function bullmqStampJobOptions() {
	return {
		removeOnComplete: { ...BULLMQ_REMOVE_ON_COMPLETE },
		removeOnFail: { ...BULLMQ_REMOVE_ON_FAIL },
	};
}
