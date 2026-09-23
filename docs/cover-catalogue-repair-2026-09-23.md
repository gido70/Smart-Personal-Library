# Cover and intake catalogue repair — 2026-09-23

Branch: `fix/reliable-original-covers`, based on production commit `792881d`.
Scope: book cover decoding, bounded automatic catalogue intake, author-index linking, and the project concept index.

## Confirmed cause

The supplied PDF has 244 pages. Its first page contains a JPEG 2000 (`JPXDecode`) image. The old PDF.js setup omitted runtime decoder assets and `wasmUrl`, so it rendered the background/page number and cached that incomplete page as a JPEG. The earlier Samsung lazy-loading, authenticated downloads and two-worker limit remain present.

The PDF's embedded Author and Title fields are empty. Previous upload code used only those metadata fields; it did not read the printed catalogue or sync an author on upload. The printed catalogue on page 4 supplies the author's inverted heading.

## Changes

- `vite.config.ts`, `.gitignore`, `src/lib/pdfAssets.ts`: ship matching PDF.js decoder assets with the app, including the non-WASM fallback; Pages subdirectory-compatible URLs.
- `src/App.tsx`, `src/Reader.tsx`, `src/lib/localAnalysis.ts`, `src/lib/library.ts`: configure decoders; regenerate active thumbnails as `cover-v2.jpg`; preserve archived covers; retain existing mobile resource limits.
- `src/lib/autoCatalogue.ts`, `src/lib/uploadPreparation.ts`: at most six opening pages, six-second text-sample deadline inside existing bounded preparation; evidence-based author extraction and provisional broad shelf classification, no external AI/API.
- `src/lib/library.ts`, `src/App.tsx`: sync author links; repair older active-book metadata while the cover worker is already open; compare-and-set prevents overwriting concurrent/manual corrections; retry missing author links on index entry.
- `public/sw.js`, `src/App.tsx`: update cache revision and one-time worker refresh marker.
- `docs/concept-index-v1.1.html`: add intake-quality implementation, limitations and evaluation measures for the research project.
- Regression scripts and package test command updated for new cache revision and catalogue tests.

## Validation

- Production TypeScript/Vite build and full existing `npm test` suite passed. After final cleanup, build, upload, catalogue, index/export and mocked storage repair checks passed again.
- Real private PDF, local Chromium mobile-size viewport: reproduced missing image with old setup (dark-pixel ratio 0.000), fixed rendering 0.647, JavaScript fallback 0.647. Original cover visually checked. No private fixture is committed.
- Real PDF text sample: author extracted from page 4; category 610 (provisional).
- Mocked authenticated storage integration: saved-book repair, author link, idempotence, preservation of paid metadata and manual corrections, concurrent edit wins. No production writes.
- Existing upload tests verify 101 MB parsing, 150 MiB limit behaviour, six-MiB chunks, progress, retry/timeout and worker cleanup.
- WebKit download succeeded, but OS libraries are unavailable and package installation failed. Actual iPhone/Safari and Samsung hardware testing remains outstanding; Chromium emulation is not device certification.

## Limits / exact next step

Textless scanned books need OCR; unknown authors are not invented. Local rule-based categories are provisional, not full RDA or authoritative detailed Dewey. Archived originals are not redownloaded/reclassified. No paid processing, database migration, schema/RLS change, or production book deletion.

Push safe branch, open PR and verify hosted preview/CI. Review the existing book on iPhone and Samsung on that preview, including reopening the shelf and author index, before production merge. Existing deployed book data is not claimed repaired until the authenticated preview runs the repair successfully.

## Follow-up: slow iPhone covers / Samsung report (cover-fast-6)

User confirmed the real cover appeared on iPhone, but loading all covers was very slow; Samsung remained unresolved. Inspection of saved storage metadata confirmed all six active books already have small `cover-v2.jpg` files. The affected book has a 58,194-byte v2 thumbnail and a 101,968,893-byte PDF. Its old 5,209-byte `cover.jpg` is the incomplete legacy rendering. No storage records were changed during this inspection.

Compared the historical Samsung fix (`d2d3b3c`, merged via `9e9711e`) with this PR. The previous revision invalidated every active legacy thumbnail and could decode the same full PDF twice for hero/shelf cards. It also waited for catalogue repair before initiating thumbnail persistence.

Corrections:
- Reuse healthy legacy JPEGs; validate images and regenerate almost-empty legacy placeholders only. Keep archived covers even if minimalist.
- Share and cache small thumbnail blobs across cards in a bounded, account-scoped memory cache. Repeated cards reuse one request; at most one fallback PDF worker runs.
- Prepare the JPEG from the already-read local PDF during upload. Save it without waiting for author indexing and reuse it immediately on the uploading device.
- Render fallback into a detached standard canvas, so React unmounts do not discard work. Avoid experimental image decoder/offscreen-canvas paths for thumbnail generation.
- Repair existing catalogue metadata independently using bounded byte-range text reads. Fix the JSON equality filter: it must use `JSON.stringify(before)`, not `[object Object]`. Preserve concurrent/manual edits.
- Recognize the photographed Arabic title followed by a hyphen as a provisional medicine/health category.
- Update the app worker revision to `cover-fast-6`; keep the v2 thumbnail filename so valid images are not invalidated again.

Validation:
- Mocked browser integration with iPhone and Samsung user agents: hero/shelf shared request, healthy legacy fallback, archived cover, account boundary; 4 small-image requests / 10,209 bytes and **zero PDF downloads**. Timings are synthetic, not measurements of the user's network or native Safari/Samsung hardware.
- Actual supplied PDF: one local file read; 34,642-byte JPEG generated during preparation; almost-empty legacy image rejected, archived minimalist image retained.
- Actual supplied PDF via a local range-capable server: 13 range requests and 3,484,669 bytes sent, rather than 101,968,893 bytes; author extraction correct.
- Catalogue integration verifies valid serialized JSON, persistent repair, author link, retained paid metadata, manual blank/name/classification preservation and concurrent edit protection.
- Build/full test suite checked for this revision; GitHub preview checks must pass before presenting the update.

Publication: update the existing approved branch/PR #40. Do not merge production during this follow-up. Exact next step: open the updated **same preview URL on both devices**, verify repeat shelf visits and author index. The original GitHub Pages main site does not yet contain PR #40. Physical Samsung success is not yet confirmed.
