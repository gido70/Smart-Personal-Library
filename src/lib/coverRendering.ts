import type { PDFDocumentProxy } from 'pdfjs-dist';

/** A detached canvas survives React unmounts while the shared request finishes. */
export async function renderCoverFromPdf(pdf: PDFDocumentProxy): Promise<Blob> {
  const page = await pdf.getPage(1);
  const canvas = document.createElement('canvas');
  try {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(1.2, 420 / base.width) });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('COVER_CANVAS_UNAVAILABLE');
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('COVER_EXPORT_FAILED')), 'image/jpeg', 0.82));
    if (!(await usableCover(blob, true))) throw new Error('COVER_HAS_NO_VISIBLE_DETAIL');
    return blob;
  } finally {
    page.cleanup();
    canvas.width = canvas.height = 0;
  }
}

/** Validate cached JPEG decoding; reject only almost-empty legacy placeholders.
 * Archived covers are never rejected for low detail, since originals are gone. */
export async function usableCover(blob: Blob, legacy: boolean): Promise<boolean> {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('COVER_IMAGE_TIMEOUT')), 8000);
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('COVER_IMAGE_INVALID'));
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight) return false;
    if (!legacy) return true;
    const canvas = document.createElement('canvas');
    canvas.width = 48; canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) return true;
    context.drawImage(image, 0, 0, 48, 64);
    const rgba = context.getImageData(0, 0, 48, 64).data;
    const bins = new Map<number, number>();
    for (let i = 0; i < rgba.length; i += 4) {
      const bin = (rgba[i] >> 5) * 64 + (rgba[i + 1] >> 5) * 8 + (rgba[i + 2] >> 5);
      bins.set(bin, (bins.get(bin) ?? 0) + 1);
    }
    return Math.max(...bins.values()) / (48 * 64) < 0.985;
  } catch { return false; }
  finally { if (timer) clearTimeout(timer); image.onload = image.onerror = null; URL.revokeObjectURL(url); }
}
