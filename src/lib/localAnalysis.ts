// Browser-only orchestration for the free "local structural analysis" experience.
// Downloads the book's own bytes straight from the user's private storage bucket
// (RLS-scoped, same session — no new network path is opened), runs PDF.js text
// extraction page by page, and hands the plain text off to the pure helpers in
// textAnalysis.ts. Nothing here ever calls OpenAI/Claude/Gemini or any external API.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { supabase } from "./supabase";
import { backfillBookMetadataFromLocalAnalysis, saveLocalAnalysis } from "./library";
import { blobToArrayBuffer, buildLocalStructuralAnalysis, extractPdfPageText, type LocalStructuralAnalysis } from "./textAnalysis";
import type { PilotBook } from "./library";

export type LocalAnalysisProgress = { page: number; totalPages: number };
export type LocalAnalysisRunResult = {
  analysis: LocalStructuralAnalysis;
  /** Fields actually written back to spl_books (source_language/title), if any. */
  appliedBookPatch: Partial<PilotBook>;
};

async function loadPdfDocument(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  return pdfjs.getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false }).promise;
}

export async function runLocalStructuralAnalysis(
  book: Pick<PilotBook, "id" | "storage_path" | "output_language" | "title" | "source_language">,
  onProgress?: (progress: LocalAnalysisProgress) => void,
): Promise<LocalAnalysisRunResult> {
  const { data: blob, error: downloadError } = await supabase!.storage.from("spl-books").download(book.storage_path);
  if (downloadError || !blob) throw downloadError ?? new Error("BOOK_DOWNLOAD_FAILED");
  const bytes = new Uint8Array(await blobToArrayBuffer(blob));

  const document = await loadPdfDocument(bytes);
  const totalPages = document.numPages;
  const pagesText: string[] = [];
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = extractPdfPageText(
      content.items.map((item) =>
        "str" in item ? { str: item.str ?? "", hasEOL: item.hasEOL } : {},
      ),
    );
    pagesText.push(text);
    onProgress?.({ page: pageNumber, totalPages });
  }

  let metadata: Record<string, unknown> = {};
  try {
    const meta = await document.getMetadata();
    metadata = (meta?.info as Record<string, unknown>) ?? {};
  } catch {
    metadata = {};
  }

  const analysis = buildLocalStructuralAnalysis(pagesText, metadata);
  const language = analysis.detected_language === "en" ? "en" : "ar";
  await saveLocalAnalysis(book.id, language, analysis);
  // Best-effort only: never fail the analysis result because the metadata
  // backfill (writing detected language / a better title back to
  // spl_books) hit an error. See library.ts for why this is conservative.
  const appliedBookPatch = await backfillBookMetadataFromLocalAnalysis(book, analysis).catch(() => ({}));
  return { analysis, appliedBookPatch };
}
