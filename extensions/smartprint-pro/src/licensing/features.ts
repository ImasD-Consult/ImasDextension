export type SmartPrintFeatureCode =
	| "PROCESS_VIEW"
	| "BATCH_QR"
	| "VERSION_UPLOAD"
	| "WBS"
	| "QR_TARGETS";

export const FEATURE_BY_COMMAND: Record<string, SmartPrintFeatureCode | undefined> = {
	processes: "PROCESS_VIEW",
	batch_qr_project: "BATCH_QR",
	version_upload_project: "VERSION_UPLOAD",
	wbs: "WBS",
	qr: "QR_TARGETS",
};

export const FEATURE_LABEL: Record<SmartPrintFeatureCode, string> = {
	PROCESS_VIEW: "Processes",
	BATCH_QR: "Batch QR",
	VERSION_UPLOAD: "File Version Upload",
	WBS: "WBS",
	QR_TARGETS: "QR Targets",
};
