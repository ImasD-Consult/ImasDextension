export function inputKey(jobId: string): string {
	return `pdfqr:input:${jobId}`;
}

export function outputKey(jobId: string): string {
	return `pdfqr:output:${jobId}`;
}

export function trimbleBatchStatusKey(jobId: string): string {
	return `pdfqr:trimble:batch:status:${jobId}`;
}
