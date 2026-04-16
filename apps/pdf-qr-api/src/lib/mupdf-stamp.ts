import mupdf from "mupdf";
import QRCode from "qrcode";
import type { StampOptions } from "./schemas";

const { Document, Image, PDFAnnotation, PDFPage } = mupdf;

type Rect = [number, number, number, number];

function pageBox(page: InstanceType<typeof PDFPage>): Rect {
	return page.getBounds("CropBox");
}

function computeQrRect(
	box: Rect,
	position: StampOptions["position"],
	size: number,
	edgeInset: number,
	offsetX: number,
	offsetY: number,
): Rect {
	const [x0, y0, x1, y1] = box;
	const w = x1 - x0;
	const h = y1 - y0;
	const s = size;
	const m = edgeInset;

	let left: number;
	let bottom: number;

	switch (position) {
		case "bottom-left":
			left = x0 + m;
			bottom = y0 + m;
			break;
		case "bottom-right":
			left = x1 - m - s;
			bottom = y0 + m;
			break;
		case "top-left":
			left = x0 + m;
			bottom = y1 - m - s;
			break;
		case "top-right":
			left = x1 - m - s;
			bottom = y1 - m - s;
			break;
		case "center": {
			const cx = x0 + w / 2;
			const cy = y0 + h / 2;
			left = cx - s / 2;
			bottom = cy - s / 2;
			break;
		}
		default:
			left = x0 + m;
			bottom = y0 + m;
	}

	left += offsetX;
	bottom += offsetY;

	return [left, bottom, left + s, bottom + s];
}

export async function stampPdfWithQr(
	pdfBytes: Uint8Array,
	options: StampOptions,
	opts: { maxPages: number },
): Promise<{ pdf: Uint8Array; pageCount: number }> {
	const pngBuffer = await QRCode.toBuffer(options.qrText, {
		type: "png",
		margin: 1,
		errorCorrectionLevel: "M",
	});

	const doc = Document.openDocument(pdfBytes, "application/pdf");
	if (doc.needsPassword()) {
		throw new Error("PDF is password-protected");
	}
	const pdf = doc.asPDF();
	if (!pdf) {
		throw new Error("Not a PDF document");
	}

	const pageCount = pdf.countPages();
	if (pageCount > opts.maxPages) {
		throw new Error(`PDF exceeds max pages (${opts.maxPages})`);
	}
	const qrImage = new Image(pngBuffer);

	const baseInset = options.layoutMode === "override" ? 6 : 36;
	const extra = options.marginPt ?? 0;
	const edgeInset = baseInset + extra;

	for (let i = 0; i < pageCount; i++) {
		const page = pdf.loadPage(i) as InstanceType<typeof PDFPage>;
		const box = pageBox(page);
		const rect = computeQrRect(
			box,
			options.position,
			options.qrSizePt,
			edgeInset,
			options.offsetXPt,
			options.offsetYPt,
		);

		const annot = page.createAnnotation("Stamp");
		annot.setIntent("StampImage");
		annot.setStampImage(qrImage);
		annot.setRect(rect);
		annot.setFlags(PDFAnnotation.IS_PRINT);
		page.update();
	}

	const out = pdf.saveToBuffer();
	return { pdf: out.asUint8Array(), pageCount };
}
