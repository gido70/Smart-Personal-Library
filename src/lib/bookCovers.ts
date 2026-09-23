import { needsCatalogueRepair } from './autoCatalogue';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createCoverCache, createPdfQueue } from './coverCache';
import { renderCoverFromPdf, usableCover } from './coverRendering';
import { ACTIVE_COVER_FILENAME, pdfImageOptions } from './pdfAssets';
import { createBookSignedUrl, downloadBookFile, isBookArchived, repairIntakeCatalogue, saveCoverThumbnail, type PilotBook } from './library';
import { ensurePilotSession } from './supabase';
import { withUploadDeadline } from './uploadPreparation';

const covers = createCoverCache();
const runPdf = createPdfQueue();
const catalogueAttempted = new Map<string, number>();
function coverKey(book: Pick<PilotBook, 'storage_path' | 'content_sha256' | 'metadata'>) {
  return `${book.storage_path}|${book.content_sha256 ?? ''}|${book.metadata?.archive_cover_path ?? ''}`;
}
export function rememberBookCover(book: Pick<PilotBook, 'storage_path' | 'content_sha256' | 'metadata'>, blob: Blob) {
  covers.remember(coverKey(book), blob);
}
export function activeCoverThumbnailPath(book: Pick<PilotBook, 'storage_path'>, filename = ACTIVE_COVER_FILENAME) {
  const separator = book.storage_path.lastIndexOf('/');
  return separator >= 0 ? `${book.storage_path.slice(0, separator)}/${filename}` : '';
}

function queueCatalogueRepair(book: PilotBook) {
  if (!needsCatalogueRepair(book.metadata ?? {}) || isBookArchived(book) || Date.now() - (catalogueAttempted.get(book.storage_path) ?? 0) < 60000) return;
  catalogueAttempted.set(book.storage_path, Date.now());
  if (catalogueAttempted.size > 24) catalogueAttempted.delete(catalogueAttempted.keys().next().value!);
  // Repair old metadata separately: use bounded range reads for text only,
  // without downloading all 102 MB or holding up the already visible JPEG.
  void runPdf(async () => {
    const signed = await withUploadDeadline(createBookSignedUrl(book.storage_path), 8000, 'COVER_URL_TIMEOUT');
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const task = pdfjs.getDocument({ ...pdfImageOptions(), url: signed.url, disableStream: true, disableAutoFetch: true, rangeChunkSize: 65536, disableFontFace: true });
    try {
      await withUploadDeadline(task.promise.then(pdf => repairIntakeCatalogue(book, pdf)), 45000, 'CATALOGUE_REPAIR_TIMEOUT');
    } finally { await task.destroy(); }
  }).catch(error => console.warn('SPL: background catalogue repair deferred', error));
}

export async function loadOriginalCover(book: PilotBook): Promise<Blob> {
  const session = await ensurePilotSession();
  // Even an in-memory hit must pass the current account boundary.
  if (!book.storage_path.startsWith(`${session.user.id}/`)) throw new Error('COVER_OWNER_MISMATCH');
  return covers.load(coverKey(book), async () => {
    const archived = isBookArchived(book);
    const cachedPaths = [...new Set((archived
      ? [String(book.metadata?.archive_cover_path ?? ''), String(book.metadata?.cover_path ?? ''), activeCoverThumbnailPath(book), activeCoverThumbnailPath(book, 'cover.jpg')]
      : [activeCoverThumbnailPath(book), String(book.metadata?.cover_path ?? ''), activeCoverThumbnailPath(book, 'cover.jpg')]
    ).filter(Boolean))];
    for (const cachedPath of cachedPaths) {
      try {
        const blob = await downloadBookFile(cachedPath, 12000);
        if (!(await usableCover(blob, !archived && !cachedPath.endsWith(`/${ACTIVE_COVER_FILENAME}`)))) continue;
        // Existing healthy Samsung thumbnails remain usable. No PDF download.
        return blob;
      } catch { /* Missing/corrupt thumbnail: try another small image first. */ }
    }
    if (archived) throw new Error('ARCHIVED_COVER_UNAVAILABLE');
    return runPdf(async () => {
      const fileBlob = await downloadBookFile(book.storage_path, 90000);
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const task = pdfjs.getDocument({ ...pdfImageOptions(), ...coverCompatibilityOptions(), stopAtErrors: true, data: new Uint8Array(await fileBlob.arrayBuffer()), disableFontFace: true });
      try {
        const pdf = await withUploadDeadline(task.promise, 25000, 'COVER_PDF_TIMEOUT');
        const blob = await withUploadDeadline(renderCoverFromPdf(pdf), 20000, 'COVER_RENDER_TIMEOUT');
        // Persist immediately; catalogue errors cannot delay the next device.
        void saveCoverThumbnail(book, blob);
        // Queue text repair after releasing this worker; do not delay display.
        return blob;
      } finally { await task.destroy(); }
    });
  }).then(blob => { queueCatalogueRepair(book); return blob; });
}

/** Use the standard canvas path on mobile instead of experimental image APIs. */
export function coverCompatibilityOptions() {
  return { isOffscreenCanvasSupported: false, isImageDecoderSupported: false };
}
