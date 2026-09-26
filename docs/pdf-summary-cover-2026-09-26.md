# PDF summary cover

PDF exports now prepend the stored original cover at its natural aspect ratio,
with a clear Arabic/English label identifying the file as a summary/analysis.
Existing report text, questions, RTL layout and numbering remain intact.

Only existing images inside the book's own storage directory are read: retained
archive cover, cover-v2, explicit image path, legacy JPEG. No original PDF is
downloaded and no cover generation/cache, cloud data or paid output is changed.
Unavailable or undecodable images fall back to the existing text-only export.
Word/audio downloads and offline playback are unchanged.

Tests cover saved/archived paths, foreign-path exclusion, missing/invalid image
fallback, page counts and aspect ratio. A real-canvas PDF was rendered using the
cover supplied by the user. Actual mobile download behavior remains a user check.
