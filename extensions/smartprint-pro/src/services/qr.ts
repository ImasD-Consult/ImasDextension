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

function isHttpUrl(value: string | undefined): boolean {
	if (!value) return false;
	return /^https?:\/\//i.test(value.trim());
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

function buildDefaultTrimbleViewerUrl(
	payload: QrTargetPayload,
	origin: string,
): string | null {
	if (!payload.projectId) return null;
	const modelId = payload.modelVersionId ?? payload.modelId;
	if (!modelId) return null;
	const hostname = (() => {
		try {
			return new URL(origin).hostname;
		} catch {
			return "";
		}
	})();
	const params = new URLSearchParams();
	params.set("modelId", modelId);
	if (hostname) params.set("origin", hostname);
	return `https://web.connect.trimble.com/projects/${encodeURIComponent(payload.projectId)}/viewer/3d/?${params.toString()}`;
}

export function buildQrNavigationUrl(payload: QrTargetPayload): string | null {
	const origin =
		getRuntimeTrimbleConnectOrigin() ??
		(import.meta as ImportMeta & { env?: { VITE_TRIMBLE_CONNECT_ORIGIN?: string } })
			.env?.VITE_TRIMBLE_CONNECT_ORIGIN?.trim() ??
		"https://web.connect.trimble.com";
	const template = getRuntimeQrUrlTemplate();
	if (template) {
		return applyTemplate(template, payload, origin);
	}
	if (isHttpUrl(payload.targetUrl)) {
		return payload.targetUrl!.trim();
	}
	if (isHttpUrl(payload.partLink)) {
		return (payload.partLink ?? "").trim();
	}
	return buildDefaultTrimbleViewerUrl(payload, origin);
}

export async function toQrDataUrl(value: string): Promise<string> {
	return QRCode.toDataURL(value, {
		margin: 2,
		width: 256,
		errorCorrectionLevel: "M",
	});
}
