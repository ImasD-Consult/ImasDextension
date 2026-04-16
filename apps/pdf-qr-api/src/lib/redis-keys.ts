export function inputKey(jobId: string): string {
	return `pdfqr:input:${jobId}`;
}

export function outputKey(jobId: string): string {
	return `pdfqr:output:${jobId}`;
}
