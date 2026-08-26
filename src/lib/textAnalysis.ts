// Pure, framework-free text analysis helpers for the "free local experience" (V0.7).
// No Supabase, no pdf.js, no DOM APIs beyond crypto.subtle (used only by hashFile).
// Kept dependency-free on purpose so it can be unit-tested directly with Node
// (see scripts/test-text-analysis.mjs) without spinning up a browser.

export type DetectedLanguage = "ar" | "en" | "mixed" | "unknown";

const AR_STOPWORDS = new Set([
  "من","إلى","على","في","عن","مع","هذا","هذه","ذلك","تلك","الذي","التي","الذين",
  "هو","هي","هم","أنت","أنا","نحن","كان","كانت","يكون","تكون","لا","لم","لن","ما",
  "إن","أن","لكن","أو","ثم","قد","كل","بعض","غير","بين","عند","حتى","إذا","كما",
  "كذلك","أيضا","أيضًا","دون","بعد","قبل","فوق","تحت","حول","نحو","إلا","سوف",
  "هناك","هنالك","هؤلاء","الى","او","اذا","لذلك","حيث","بها","به","لها","له",
  "منه","منها","فيه","فيها","عليه","عليها","إليه","إليها","وهو","وهي","وكان",
  "وكانت","التى","الان","الآن","نفسه","نفسها","بينما","خلال","ضمن","لدى","عبر",
]);

const EN_STOPWORDS = new Set([
  "the","a","an","and","or","but","of","to","in","on","at","for","with","by",
  "is","are","was","were","be","been","being","this","that","these","those",
  "it","its","as","from","not","no","so","if","then","than","into","about",
  "which","who","whom","whose","what","when","where","why","how","there",
  "their","they","them","he","she","his","her","we","you","your","our","i",
  "do","does","did","have","has","had","will","would","can","could","should",
  "may","might","must","also","such","more","most","other","some","any","all",
  "each","because","between","through","over","under","again","further","once",
]);

/** Detects the dominant script of a text sample by counting Arabic vs Latin letters. */
export function detectLanguage(text: string): DetectedLanguage {
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (arabic === 0 && latin === 0) return "unknown";
  if (arabic === 0) return "en";
  if (latin === 0) return "ar";
  const ratio = arabic / (arabic + latin);
  if (ratio > 0.65) return "ar";
  if (ratio < 0.35) return "en";
  return "mixed";
}

/** Splits page/document text into lowercase word tokens, dropping pure punctuation/digits-only noise. */
export function tokenize(text: string): string[] {
  const matches = text.match(/[\p{L}\p{M}]+/gu) ?? [];
  return matches.map((word) => word.toLowerCase()).filter((word) => word.length > 1);
}

export type TermCount = { term: string; count: number };

/** Ranks the most frequent non-stopword terms. `lang` picks the stopword list; "mixed"/"unknown" use both. */
export function topTerms(tokens: string[], lang: DetectedLanguage, limit = 20): TermCount[] {
  const stop = lang === "ar" ? AR_STOPWORDS : lang === "en" ? EN_STOPWORDS : new Set([...AR_STOPWORDS, ...EN_STOPWORDS]);
  const counts = new Map<string, number>();
  for (const token of tokens) {
    if (stop.has(token)) continue;
    if (/^\d+$/.test(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, limit);
}

export type HeadingCandidate = { page: number; text: string; score: number };

export type PdfTextFragment = { str?: string; hasEOL?: boolean };

/** Preserves PDF.js line endings so structural rules see headings as lines. */
export function extractPdfPageText(items: PdfTextFragment[]): string {
  return items
    .map((item) => `${item.str ?? ""}${item.hasEOL ? "\n" : " "}`)
    .join("")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

/**
 * Detects lines that repeat across many pages — running headers, footers,
 * page-number stamps — and strips them before heading/summary detection.
 *
 * Fixes bug (و) from FAILURE-EVIDENCE.md: the desktop extractive summary
 * repeated a single running-header line ("Claude 5: كزميل عمل 100 خطوة
 * لإتقان") once per page for pages 60-67, because nothing filtered lines
 * that are structurally boilerplate rather than book content. A line is
 * boilerplate here if its normalized form (trimmed, digits collapsed to a
 * single placeholder so "Page 12"/"Page 13" count as the same line) occurs
 * on at least 4 distinct pages, or on more than a third of all pages,
 * whichever is smaller — a real sentence essentially never repeats near-
 * verbatim that often, while headers/footers/page stamps do by design.
 * Only the first and last 3 lines of each page are checked, since running
 * headers/footers live at page edges, not in the body text.
 */
export function stripRepeatedLines(pages: string[]): string[] {
  if (pages.length < 4) return pages;
  const normalize = (line: string) =>
    line
      .trim()
      .replace(/\d+/g, "#")
      .replace(/\s+/g, " ")
      .toLowerCase();
  const pageLines = pages.map((pageText) => pageText.split(/\n+/).map((line) => line.trim()).filter(Boolean));
  const edgeCounts = new Map<string, Set<number>>();
  pageLines.forEach((lines, pageIndex) => {
    const edges = [...lines.slice(0, 3), ...lines.slice(-3)];
    for (const line of edges) {
      if (line.length < 3 || line.length > 90) continue;
      const key = normalize(line);
      if (!key) continue;
      if (!edgeCounts.has(key)) edgeCounts.set(key, new Set());
      edgeCounts.get(key)!.add(pageIndex);
    }
  });
  const threshold = Math.min(4, Math.ceil(pages.length / 3));
  const boilerplateKeys = new Set(
    [...edgeCounts.entries()].filter(([, pageSet]) => pageSet.size >= threshold).map(([key]) => key),
  );
  if (boilerplateKeys.size === 0) return pages;
  return pageLines.map((lines) => lines.filter((line) => !boilerplateKeys.has(normalize(line))).join("\n"));
}

/**
 * Heuristic table-of-contents detector over per-page plain text.
 * Rule-based only (no AI): a line is a heading candidate when it is short,
 * does not end with a mid-sentence connector, and is not a full stopword-heavy sentence.
 * This is explicitly a structural guess, not a claim about the book's real chapter titles.
 */
export function findHeadingCandidates(pages: string[], maxPerBook = 40): HeadingCandidate[] {
  const candidates: HeadingCandidate[] = [];
  pages.forEach((pageText, index) => {
    const lines = pageText
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines.slice(0, 6)) {
      const wordCount = line.split(/\s+/).filter(Boolean).length;
      if (wordCount < 2 || wordCount > 12) continue;
      if (/[.؛,،:]$/.test(line)) continue;
      const digitsOnly = /^[\d\s.\-–—]+$/.test(line);
      if (digitsOnly) continue;
      const looksNumbered = /^(\d{1,3}|[IVXLCM]{1,6})[.)\-]?\s+\S/.test(line);
      const isShortish = line.length <= 70;
      let score = 0;
      if (looksNumbered) score += 2;
      if (isShortish) score += 1;
      if (wordCount <= 6) score += 1;
      if (score >= 2) candidates.push({ page: index + 1, text: line.slice(0, 120), score });
    }
  });
  return candidates.sort((a, b) => b.score - a.score || a.page - b.page).slice(0, maxPerBook);
}

export type LocalStructuralAnalysis = {
  engine: "local_js";
  generated_at: string;
  page_count: number;
  word_count: number;
  character_count: number;
  detected_language: DetectedLanguage;
  pdf_metadata: Record<string, unknown>;
  heading_candidates: HeadingCandidate[];
  top_terms: TermCount[];
  extractive_summary?: Array<{ page: number; text: string }>;
  content_per_page: Array<{ page: number; word_count: number; character_count: number }>;
  disclosure: string;
  /**
   * Full per-page text, capped per page, used only by the free local
   * "بحث داخل الكتاب" (search inside the book) feature — see
   * searchInsideBook() below. Never sent anywhere and never labeled as
   * AI/semantic search; it backs plain substring matching only. Absent on
   * analyses produced before this field existed (older saved books simply
   * cannot be searched until re-analyzed).
   */
  pages_text?: string[];
};

const DISCLOSURE_AR =
  "هذا تحليل بنيوي وخلاصة استخراجية محلية منتَجة بقواعد ثابتة داخل متصفحك عبر PDF.js فقط. ليست ترجمة ولا تحليلًا بالذكاء الاصطناعي، ولم يُرسل نص الكتاب إلى أي خدمة خارجية. الخلاصة تختار جملًا من النص الأصلي ولا تعيد صياغتها.";

/**
 * Produces a small, clearly labelled extractive overview without any model or
 * network call. Sentences are scored by the book's frequent content terms,
 * then returned in source order with their page numbers.
 */
export function buildExtractiveSummary(
  pagesText: string[],
  terms: TermCount[],
  limit = 8,
): Array<{ page: number; text: string }> {
  const weights = new Map(terms.map(({ term, count }) => [term, count]));
  const candidates: Array<{ page: number; order: number; text: string; score: number }> = [];
  let order = 0;
  pagesText.forEach((pageText, pageIndex) => {
    const sentences = pageText
      .split(/(?<=[.!?؟؛])\s+|\n+/u)
      .map((sentence) => sentence.replace(/\s+/g, " ").trim())
      .filter((sentence) => sentence.length >= 45 && sentence.length <= 420);
    for (const sentence of sentences) {
      const sentenceTokens = tokenize(sentence);
      if (sentenceTokens.length < 7) continue;
      const score = sentenceTokens.reduce((sum, token) => sum + (weights.get(token) ?? 0), 0) /
        Math.sqrt(sentenceTokens.length);
      candidates.push({ page: pageIndex + 1, order: order++, text: sentence, score });
    }
  });
  return candidates
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .sort((a, b) => a.order - b.order)
    .map(({ page, text }) => ({ page, text }));
}

/** Caps a single page's text for storage in the searchable pages_text array. */
const MAX_SEARCH_PAGE_CHARS = 6000;
/** Above this page count, pages_text is omitted to keep the saved analysis row small. */
const MAX_SEARCHABLE_PAGES = 1200;

/** Assembles the final local_structural_analysis payload from already-extracted per-page text. */
export function buildLocalStructuralAnalysis(
  pagesText: string[],
  pdfMetadata: Record<string, unknown>,
): LocalStructuralAnalysis {
  const fullText = pagesText.join("\n");
  const language = detectLanguage(fullText);
  const tokens = tokenize(fullText);
  const terms = topTerms(tokens, language, 24);
  const contentPerPage = pagesText.map((pageText, index) => ({
    page: index + 1,
    word_count: tokenize(pageText).length,
    character_count: pageText.length,
  }));
  // Boilerplate (running headers/footers/page numbers) is stripped only for
  // heading detection and the extractive summary — word/character counts
  // above stay based on the real, unstripped page text.
  const cleanedPages = stripRepeatedLines(pagesText);
  return {
    engine: "local_js",
    generated_at: new Date().toISOString(),
    page_count: pagesText.length,
    word_count: tokens.length,
    character_count: fullText.length,
    detected_language: language,
    pdf_metadata: pdfMetadata,
    heading_candidates: findHeadingCandidates(cleanedPages),
    top_terms: terms,
    extractive_summary: buildExtractiveSummary(cleanedPages, terms),
    content_per_page: contentPerPage,
    disclosure: DISCLOSURE_AR,
    pages_text:
      pagesText.length <= MAX_SEARCHABLE_PAGES
        ? pagesText.map((pageText) => pageText.slice(0, MAX_SEARCH_PAGE_CHARS))
        : undefined,
  };
}

export type BookSearchMatch = { page: number; snippet: string };

/** Strips Arabic diacritics (tashkeel) so search matches regardless of vocalization. */
function foldForSearch(text: string): string {
  return text.replace(/[ً-ٰٟ]/g, "").toLowerCase();
}

/**
 * Plain, local, zero-cost substring search over the book's own cached page
 * text — this is the honest "بحث داخل الكتاب" from CLAUDE-REVIEW-PROMPT.md
 * §هـ(1): no model, no ranking by meaning, just real matching pages and
 * snippets. Returns [] (not an error) when pages_text is missing (analysis
 * predates this field, or the book exceeded MAX_SEARCHABLE_PAGES) so the
 * caller can show an honest "re-run the local analysis" message instead of
 * a fabricated result.
 */
export function searchInsideBook(pagesText: string[] | undefined, query: string, contextChars = 60): BookSearchMatch[] {
  const needle = foldForSearch(query.trim());
  if (!pagesText || needle.length < 2) return [];
  const matches: BookSearchMatch[] = [];
  pagesText.forEach((pageText, pageIndex) => {
    const haystack = foldForSearch(pageText);
    let from = 0;
    let guard = 0;
    while (guard++ < 20) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      const start = Math.max(0, at - contextChars);
      const end = Math.min(pageText.length, at + needle.length + contextChars);
      const snippet = `${start > 0 ? "…" : ""}${pageText.slice(start, end).replace(/\s+/g, " ").trim()}${end < pageText.length ? "…" : ""}`;
      matches.push({ page: pageIndex + 1, snippet });
      from = at + needle.length;
      if (matches.length >= 40) break;
    }
  });
  return matches;
}

/** Safari/WKWebView compatible Blob reader (Blob.arrayBuffer is not universal). */
export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  if (typeof FileReader === "undefined") return new Response(blob).arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("BLOB_READ_FAILED"));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("BLOB_READ_FAILED"));
    };
    reader.readAsArrayBuffer(blob);
  });
}

/** SHA-256 hex digest of a File/Blob's bytes, computed entirely in the browser (Web Crypto). */
export async function hashFile(file: Blob): Promise<string> {
  const buffer = await blobToArrayBuffer(file);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Manual (ChatGPT/Claude-generated, human-pasted) import schema validation
// ---------------------------------------------------------------------------

export type ManualImportSource = "manual_chatgpt" | "manual_claude" | "manual_other";
const MANUAL_SOURCES: ManualImportSource[] = ["manual_chatgpt", "manual_claude", "manual_other"];
const OUTPUT_LANGUAGES = ["ar", "en", "bilingual"] as const;

export type ManualImportPayload = {
  template_version: string;
  source: ManualImportSource;
  output_language: (typeof OUTPUT_LANGUAGES)[number];
  overview: { summary: string; key_ideas?: string[]; return_to_source?: string[] };
  chapters?: Array<{ title: string; summary: string; pages_if_known?: string }>;
  critical?: { strengths?: string[]; limitations?: string[]; platform_inferences?: string[] };
};

export type ManualImportValidation =
  | { ok: true; data: ManualImportPayload }
  | { ok: false; errors: string[] };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Validates a manually-pasted analysis JSON against the documented V0.7 schema
 * (see docs/manual-import-schema.md). Returns every error found, not just the first,
 * so the UI can show a complete, actionable rejection message.
 */
export function validateManualImport(raw: unknown): ManualImportValidation {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["JSON الجذر يجب أن يكون كائنًا (object) وليس مصفوفة أو قيمة أولية."] };
  }
  const obj = raw as Record<string, unknown>;

  if (!isNonEmptyString(obj.template_version)) errors.push("الحقل template_version مفقود أو فارغ.");
  if (!MANUAL_SOURCES.includes(obj.source as ManualImportSource)) {
    errors.push(`الحقل source يجب أن يكون أحد: ${MANUAL_SOURCES.join(", ")}.`);
  }
  if (!OUTPUT_LANGUAGES.includes(obj.output_language as (typeof OUTPUT_LANGUAGES)[number])) {
    errors.push(`الحقل output_language يجب أن يكون أحد: ${OUTPUT_LANGUAGES.join(", ")}.`);
  }
  const overview = obj.overview as Record<string, unknown> | undefined;
  if (typeof overview !== "object" || overview === null) {
    errors.push("الحقل overview مفقود ويجب أن يكون كائنًا يحتوي summary على الأقل.");
  } else {
    if (!isNonEmptyString(overview.summary)) errors.push("overview.summary مفقود أو فارغ.");
    if (overview.key_ideas !== undefined && !isStringArray(overview.key_ideas)) {
      errors.push("overview.key_ideas يجب أن تكون مصفوفة نصوص إن وُجدت.");
    }
    if (overview.return_to_source !== undefined && !isStringArray(overview.return_to_source)) {
      errors.push("overview.return_to_source يجب أن تكون مصفوفة نصوص إن وُجدت.");
    }
  }
  if (obj.chapters !== undefined) {
    if (!Array.isArray(obj.chapters)) {
      errors.push("chapters يجب أن تكون مصفوفة إن وُجدت.");
    } else {
      obj.chapters.forEach((chapter, index) => {
        if (typeof chapter !== "object" || chapter === null) {
          errors.push(`chapters[${index}] يجب أن يكون كائنًا.`);
          return;
        }
        const c = chapter as Record<string, unknown>;
        if (!isNonEmptyString(c.title)) errors.push(`chapters[${index}].title مفقود أو فارغ.`);
        if (!isNonEmptyString(c.summary)) errors.push(`chapters[${index}].summary مفقود أو فارغ.`);
      });
    }
  }
  if (obj.critical !== undefined) {
    if (typeof obj.critical !== "object" || obj.critical === null) {
      errors.push("critical يجب أن يكون كائنًا إن وُجد.");
    } else {
      const c = obj.critical as Record<string, unknown>;
      for (const key of ["strengths", "limitations", "platform_inferences"] as const) {
        if (c[key] !== undefined && !isStringArray(c[key])) {
          errors.push(`critical.${key} يجب أن تكون مصفوفة نصوص إن وُجدت.`);
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: obj as unknown as ManualImportPayload };
}
