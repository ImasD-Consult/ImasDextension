import QRCode from "qrcode";
import {
	getRuntimeQrUrlTemplate,
	getRuntimeTrimbleConnectOrigin,
} from "../lib/runtime-env";

export type QrTargetPayload = {
	v: 1;
	projectId?: string;
	modelId: string;
	modelVersionId?: string;
	partId: string;
	partName: string;
	partType?: string;
	partLink?: string;
	targetUrl?: string;
	createdAt: string;
};

function toBase64Url(input: string): string {
	return btoa(unescape(encodeURIComponent(input)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function applyTemplate(
	template: string,
	payload: QrTargetPayload,
	origin: string,
): string {
	return template
		.replaceAll("{origin}", encodeURIComponent(origin))
		.replaceAll("{modelId}", encodeURIComponent(payload.modelId))
		.replaceAll(
			"{modelVersionId}",
			encodeURIComponent(payload.modelVersionId ?? ""),
		)
		.replaceAll("{partId}", encodeURIComponent(payload.partId))
		.replaceAll("{partLink}", encodeURIComponent(payload.partLink ?? ""));
}

export function buildQrNavigationUrl(payload: QrTargetPayload): string {
	const origin =
		getRuntimeTrimbleConnectOrigin() ??
		(import.meta as ImportMeta & { env?: { VITE_TRIMBLE_CONNECT_ORIGIN?: string } })
			.env?.VITE_TRIMBLE_CONNECT_ORIGIN?.trim() ??
		"https://web.connect.trimble.com";
	const template = getRuntimeQrUrlTemplate();
	if (template) {
		return applyTemplate(template, payload, origin);
	}
	if (payload.partLink?.trim()) {
		return payload.partLink.trim();
	}
	const encoded = toBase64Url(JSON.stringify(payload));
	return `${origin.replace(/\/+$/, "")}/?smartprint_target=${encoded}`;
}

export async function toQrDataUrl(value: string): Promise<string> {
	return QRCode.toDataURL(value, {
		margin: 2,
		width: 256,
		errorCorrectionLevel: "M",
	});
}
