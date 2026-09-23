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

## Final handoff state

Implementation commit: `207d7b6` on `fix/reliable-original-covers`.
The attempted GitHub push was blocked by automatic approval review: publishing the feature branch to GitHub needs explicit authorization for these changes. No alternative write channel was attempted. Remote publication and preview creation are unconfirmed/not completed; production was not merged or deployed.
Exact next step: obtain explicit approval to push this branch to `gido70/Smart-Personal-Library`, then create the PR, inspect CI/preview and perform the outstanding device checks.
