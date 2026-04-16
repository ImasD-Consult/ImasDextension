import QRCode from "qrcode";

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

export function buildQrNavigationUrl(payload: QrTargetPayload): string {
	const encoded = toBase64Url(JSON.stringify(payload));
	return `smartprintpro://open-target?d=${encoded}`;
}

export async function toQrDataUrl(value: string): Promise<string> {
	return QRCode.toDataURL(value, {
		margin: 2,
		width: 256,
		errorCorrectionLevel: "M",
	});
}
