import {
	goneErrorSchema,
	jobFailedErrorSchema,
	notFoundErrorSchema,
	notReadyErrorSchema,
	resultDownload404Schema,
	simpleErrorSchema,
	validationErrorSchema,
} from "./errors";
import {
	enqueueResponseSchema,
	jobIdParamsSchema,
	jobStatusResponseSchema,
} from "./job";
import {
	layoutModeSchema,
	qrPositionSchema,
	stampJobPayloadSchema,
	stampOptionsSchema,
} from "./stamp";
import { pdfQrUploadBodySchema } from "./upload";

/**
 * Schemas merged into `components.schemas` and deduplicated to `$ref` in OpenAPI when
 * the generated JSON matches (see `createJsonSchemaTransformObject`).
 */
export const openapiComponentSchemas = {
	QrPosition: qrPositionSchema,
	LayoutMode: layoutModeSchema,
	StampOptions: stampOptionsSchema,
	StampJobPayload: stampJobPayloadSchema,
	EnqueueResponse: enqueueResponseSchema,
	JobStatusResponse: jobStatusResponseSchema,
	JobIdPathParams: jobIdParamsSchema,
	PdfQrUploadForm: pdfQrUploadBodySchema,
	SimpleError: simpleErrorSchema,
	ValidationError: validationErrorSchema,
	NotFoundError: notFoundErrorSchema,
	JobFailedError: jobFailedErrorSchema,
	GoneError: goneErrorSchema,
	NotReadyError: notReadyErrorSchema,
	ResultDownload404: resultDownload404Schema,
} as const;
