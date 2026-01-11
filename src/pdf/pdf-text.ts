import {
	getDocument,
	GlobalWorkerOptions,
	type PDFDocumentProxy,
	type TextContent,
	type TextItem,
} from "pdfjs-dist/legacy/build/pdf.mjs";

// We avoid bundling a worker; acceptable for small/medium PDFs.
GlobalWorkerOptions.workerSrc = "";

const MAX_BYTES = 16 * 1024 * 1024; // 16 MB limit
const MAX_PAGES = 50;

function isTextItem(item: unknown): item is TextItem {
	return Boolean(item && typeof item === "object" && "str" in item && typeof (item as { str?: unknown }).str === "string");
}

function flattenTextContent(content: TextContent): string {
	const text = content.items
		.map((item) => (isTextItem(item) ? item.str : ""))
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();

	return text;
}

export async function pdfToText(bytes: ArrayBuffer): Promise<string> {
	if (bytes.byteLength > MAX_BYTES) {
		throw new Error("PDF too large (over 16 MB)");
	}

	const pdf: PDFDocumentProxy = await getDocument({ data: new Uint8Array(bytes), disableWorker: true }).promise;

	try {
		const pageCount = Math.min(pdf.numPages, MAX_PAGES);
		const parts: string[] = [];

		for (let i = 1; i <= pageCount; i++) {
			const page = await pdf.getPage(i);
			const content = await page.getTextContent();
			const text = flattenTextContent(content);

			if (text) {
				parts.push(`Page ${i}:\n${text}`);
			}
		}

		if (pdf.numPages > MAX_PAGES) {
			parts.push(`(Trimmed to first ${MAX_PAGES} pages of ${pdf.numPages})`);
		}

		return parts.join("\n\n");
	} finally {
		await pdf.destroy();
	}
}
