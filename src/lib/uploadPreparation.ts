export type PreparationStage = "reading" | "hashing" | "inspecting";
export type PdfInspection = { pageCount: number | null; info: Record<string, unknown> };
type PdfDocument = { numPages: number; getMetadata: () => Promise<{ info: unknown }> };
type LoadingTask = { promise: Promise<PdfDocument>; destroy: () => Promise<void> };

export async function withUploadDeadline<T>(operation: PromiseLike<T>, milliseconds: number, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(code)), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}

// The PDF worker transfers (detaches) its input buffer. Hash BEFORE handing it
// to pdf.js, and release the worker before starting the network upload.
export async function prepareUpload(
  file: Blob,
  getDocument: (bytes: Uint8Array) => LoadingTask,
  onStage: (stage: PreparationStage) => void = () => {},
  timeoutMs = 25000,
): Promise<{ contentHash: string; inspection: PdfInspection }> {
  onStage("reading");
  const buffer = await withUploadDeadline(file.arrayBuffer(), 60000, "FILE_READ_TIMEOUT");
  onStage("hashing");
  const digest = await withUploadDeadline(crypto.subtle.digest("SHA-256", buffer), 60000, "FILE_HASH_TIMEOUT");
  const contentHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  onStage("inspecting");
  const task = getDocument(new Uint8Array(buffer));
  try {
    const inspection = await withUploadDeadline((async () => {
      const document = await task.promise;
      let info: Record<string, unknown> = {};
      try { info = (await document.getMetadata()).info as Record<string, unknown> ?? {}; } catch { /* optional metadata */ }
      return { pageCount: document.numPages, info };
    })(), timeoutMs, "PDF_INSPECTION_TIMEOUT");
    return { contentHash, inspection };
  } catch (error) {
    // Metadata/page counting is not a page-limit gate. A slow PDF can still be
    // stored and opened later; malformed/password-protected PDFs still error.
    if (!(error instanceof Error) || error.message !== "PDF_INSPECTION_TIMEOUT") throw error;
    return { contentHash, inspection: { pageCount: null, info: {} } };
  } finally {
    try { await withUploadDeadline(task.destroy(), 2000, "PDF_CLEANUP_TIMEOUT"); } catch { /* cleanup cannot hang the upload */ }
  }
}
