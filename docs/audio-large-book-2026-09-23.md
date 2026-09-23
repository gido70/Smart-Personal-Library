# Large book analysis and audio readiness — 2026-09-23

Production screenshot: OPENAI_400 / file_above_max_size (50 MB), not a billing error. Library original upload remains 150 MiB with no page-count gate.

Large searchable PDFs above 45,000,000 bytes use client-side PDF.js extraction of every page, with physical page markers; the server validates the complete marker sequence and page count, then sends input_text instead of the oversized PDF. No source truncation. No persistent derivative copy. Scanned/low-text books stop for OCR; more than 600,000 source characters stop for further segmentation rather than silent omission. Images/diagrams are explicitly excluded in the paid confirmation and model instructions. Small PDF file_id path stays unchanged. Book questions use the same complete text when needed.

Real supplied PDF: 244 pages, 230 text-bearing pages, 451,573 characters, 756,098 UTF-8 bytes. No OpenAI request made during this extraction.

Deployed spl-ai v16 lacked the tracked 3a195b5 long-sentence speech fix. New speech uses bounded 3900-character parts, the existing fixed voice/model/instructions/speed 0.94, and versioned part filenames. Existing paid audio retains legacy segmentation on resume and is reused without regeneration. Preview moves from v2 to the existing tracked v3. No credit purchases, auto-reload, paid generation or secret changes.

Validation: full npm test/build; mocked actual Edge handler tests large-text vs small-file requests, preflight rejection before paid fetch, consistent voice and bounded speech, legacy audio reuse; actual private PDF extraction. No listening test or native-device claim. Branch fix/audio-large-book-readiness. Exact next step: preview/CI, deploy verified function with JWT, publish frontend, then user starts one paid analysis/sample after reviewing cost.
