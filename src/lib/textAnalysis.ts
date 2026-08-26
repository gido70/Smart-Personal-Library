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
  content_per_page: Array<{ page: number; word_count: number; character_count: number }>;
  disclosure: string;
};

const DISCLOSURE_AR =
  "هذا تحليل بنيوي محلي منتَج بقواعد ثابتة داخل متصفحك عبر PDF.js فقط. ليس تلخيصًا ولا ترجمة ولا تحليلًا بالذكاء الاصطناعي، ولم يُرسل نص الكتاب إلى أي خدمة خارجية.";

/** Assembles the final local_structural_analysis payload from already-extracted per-page text. */
export function buildLocalStructuralAnalysis(
  pagesText: string[],
  pdfMetadata: Record<string, unknown>,
): LocalStructuralAnalysis {
  const fullText = pagesText.join("\n");
  const language = detectLanguage(fullText);
  const tokens = tokenize(fullText);
  const contentPerPage = pagesText.map((pageText, index) => ({
    page: index + 1,
    word_count: tokenize(pageText).length,
    character_count: pageText.length,
  }));
  return {
    engine: "local_js",
    generated_at: new Date().toISOString(),
    page_count: pagesText.length,
    word_count: tokens.length,
    character_count: fullText.length,
    detected_language: language,
    pdf_metadata: pdfMetadata,
    heading_candidates: findHeadingCandidates(pagesText),
    top_terms: topTerms(tokens, language, 24),
    content_per_page: contentPerPage,
    disclosure: DISCLOSURE_AR,
  };
}

/** SHA-256 hex digest of a File/Blob's bytes, computed entirely in the browser (Web Crypto). */
export async function hashFile(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
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
