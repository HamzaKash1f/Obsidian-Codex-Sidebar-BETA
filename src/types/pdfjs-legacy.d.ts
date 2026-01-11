declare module "pdfjs-dist/legacy/build/pdf.mjs" {
	export interface TextItem {
		str: string;
	}

	export interface TextContent {
		items: Array<TextItem | { [key: string]: unknown }>;
	}

	export interface PDFPageProxy {
		getTextContent(): Promise<TextContent>;
	}

	export interface PDFDocumentProxy {
		numPages: number;
		getPage(pageNumber: number): Promise<PDFPageProxy>;
		destroy(): Promise<void>;
	}

	export interface PDFDocumentLoadingTask {
		promise: Promise<PDFDocumentProxy>;
	}

	export function getDocument(params: { data: Uint8Array; disableWorker?: boolean }): PDFDocumentLoadingTask;

	export const GlobalWorkerOptions: { workerSrc: string };
}
