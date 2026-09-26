import type { PilotBook } from './library';

// Read only existing images in this book's directory. Never fetch a PDF,
// regenerate a cover, modify the library cache, or write to cloud storage.
export async function readReportCover(book: PilotBook, download: (path: string, timeout?: number) => Promise<Blob>): Promise<Blob | null> {
  const end = book.storage_path.lastIndexOf('/');
  if (end < 1) return null;
  const directory = book.storage_path.slice(0, end + 1);
  const paths = [...new Set([
    String(book.metadata?.archive_cover_path ?? ''),
    `${directory}cover-v2.jpg`,
    String(book.metadata?.cover_path ?? ''),
    `${directory}cover.jpg`,
  ])].filter(path => path.startsWith(directory) && !path.slice(directory.length).includes('/') && /\.(jpe?g|png|webp)$/i.test(path));
  for (const path of paths) {
    try {
      const blob = await download(path, 8000);
      if (blob.size && (!blob.type || blob.type.startsWith('image/'))) return blob;
    } catch { /* Missing saved cover must not prevent exporting the summary. */ }
  }
  return null;
}
