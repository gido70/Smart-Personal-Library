// Browser-only regression harness; not imported by the application.
export * as pdfjs from 'pdfjs-dist';
export { default as workerUrl } from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
export { pdfImageOptions } from '../src/lib/pdfAssets';
