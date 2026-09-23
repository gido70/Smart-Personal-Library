/** Resolve relative to the application, including GitHub Pages' subdirectory. */
export function pdfImageOptions() {
  return {
    wasmUrl: new URL(`${import.meta.env.BASE_URL}pdfjs/wasm/`, document.baseURI).href,
  };
}

// Old thumbnails can contain only the page background when JPX decoding failed.
// Rebuild active-book thumbnails once; archived originals may no longer exist.
export const ACTIVE_COVER_FILENAME = "cover-v2.jpg";
