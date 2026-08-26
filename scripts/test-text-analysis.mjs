// Plain-Node unit tests for src/lib/textAnalysis.ts — no browser, no Supabase, no build step.
// Run: node --experimental-strip-types scripts/test-text-analysis.mjs
import {
  detectLanguage,
  tokenize,
  topTerms,
  findHeadingCandidates,
  buildLocalStructuralAnalysis,
  buildExtractiveSummary,
  extractPdfPageText,
  validateManualImport,
  stripRepeatedLines,
  searchInsideBook,
} from "../src/lib/textAnalysis.ts";

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}`);
  }
}

check("detectLanguage: pure Arabic", detectLanguage("هذا نص عربي طويل يشرح فكرة معينة") === "ar");
check("detectLanguage: pure English", detectLanguage("This is a long English sentence about knowledge") === "en");
check("detectLanguage: mixed", detectLanguage("Knowledge إدارة management المعرفة process تحويل") === "mixed");
check("detectLanguage: empty/unknown", detectLanguage("1234 !!! ---") === "unknown");

const tokens = tokenize("إدارة المعرفة هي إدارة المعرفة داخل المؤسسة، إدارة فعالة.");
check("tokenize: extracts Arabic words", tokens.includes("إدارة") && tokens.includes("المعرفة"));
check("tokenize: drops single-letter noise", !tokens.includes("و"));

const terms = topTerms(tokens, "ar", 5);
check("topTerms: ranks repeated content word first", terms[0]?.term === "إدارة" && terms[0]?.count === 3);
check("topTerms: stopwords excluded from ranking", !terms.some((t) => t.term === "هي"));

const pages = [
  "الفصل الأول\nمقدمة عامة عن الموضوع تشرح خلفية الفكرة بجملة طويلة غير قصيرة.",
  "12\nالفصل الثاني: تحويل المعرفة\nنص طويل يشرح نموذج التحويل بين الأفراد والمؤسسة بالتفصيل الكامل.",
];
const headings = findHeadingCandidates(pages);
check("findHeadingCandidates: finds a numbered/short heading-like line", headings.some((h) => h.text.includes("الفصل")));

const extractedPage = extractPdfPageText([
  { str: "الفصل الأول", hasEOL: true },
  { str: "مقدمة عامة عن الموضوع تشرح خلفية الفكرة بجملة طويلة.", hasEOL: true },
]);
check("extractPdfPageText: preserves PDF.js line endings", extractedPage.startsWith("الفصل الأول\n"));
check(
  "PDF.js extraction feeds heading detection correctly",
  findHeadingCandidates([extractedPage]).some((h) => h.text === "الفصل الأول"),
);

const analysis = buildLocalStructuralAnalysis(pages, { Title: "كتاب تجريبي" });
check("buildLocalStructuralAnalysis: engine tag is local_js", analysis.engine === "local_js");
check("buildLocalStructuralAnalysis: page_count matches input", analysis.page_count === 2);
check("buildLocalStructuralAnalysis: word_count > 0", analysis.word_count > 0);
check("buildLocalStructuralAnalysis: per-page breakdown has 2 rows", analysis.content_per_page.length === 2);
check("buildLocalStructuralAnalysis: disclosure text present and non-empty", analysis.disclosure.length > 20);
check("buildLocalStructuralAnalysis: produces an extractive overview", analysis.extractive_summary.length > 0);
const extractive = buildExtractiveSummary(pages, topTerms(tokenize(pages.join("\n")), "ar", 20), 4);
check("buildExtractiveSummary: keeps source page references", extractive.every((item) => item.page >= 1 && item.text.length > 0));

// --- manual import schema validation ---
const validPayload = {
  template_version: "spl-manual-v1",
  source: "manual_chatgpt",
  output_language: "ar",
  overview: { summary: "خلاصة صالحة بطول كافٍ.", key_ideas: ["فكرة أولى", "فكرة ثانية"] },
  chapters: [{ title: "الفصل الأول", summary: "ملخص الفصل." }],
};
const validResult = validateManualImport(validPayload);
check("validateManualImport: accepts a well-formed payload", validResult.ok === true);

const missingSummary = { ...validPayload, overview: { key_ideas: ["x"] } };
const invalidResult1 = validateManualImport(missingSummary);
check("validateManualImport: rejects missing overview.summary", invalidResult1.ok === false && invalidResult1.errors.some((e) => e.includes("summary")));

const badSource = { ...validPayload, source: "chatgpt" };
const invalidResult2 = validateManualImport(badSource);
check("validateManualImport: rejects an unrecognised source value", invalidResult2.ok === false && invalidResult2.errors.some((e) => e.includes("source")));

const notAnObject = "just a string";
const invalidResult3 = validateManualImport(notAnObject);
check("validateManualImport: rejects a non-object root", invalidResult3.ok === false);

const badChapterShape = { ...validPayload, chapters: [{ title: "بلا ملخص" }] };
const invalidResult4 = validateManualImport(badChapterShape);
check("validateManualImport: rejects a chapter missing summary", invalidResult4.ok === false && invalidResult4.errors.some((e) => e.includes("chapters[0]")));

// --- V0.7.3: repeated header/footer stripping (fixes FAILURE-EVIDENCE.md #4:
// desktop summary repeated one running-header line across pages 60-67) ---
const headerRepro = [
  "الفصل الخامس\nنص فعلي مختلف في هذه الصفحة يتحدث عن موضوع أول بجملة طويلة كافية للاختيار.",
  "Claude 5: كزميل عمل\nنص فعلي مختلف في هذه الصفحة يتحدث عن موضوع ثانٍ بجملة طويلة كافية للاختيار.",
  "Claude 5: كزميل عمل\nنص فعلي مختلف في هذه الصفحة يتحدث عن موضوع ثالث بجملة طويلة كافية للاختيار.",
  "Claude 5: كزميل عمل\nنص فعلي مختلف في هذه الصفحة يتحدث عن موضوع رابع بجملة طويلة كافية للاختيار.",
  "Claude 5: كزميل عمل\nنص فعلي مختلف في هذه الصفحة يتحدث عن موضوع خامس بجملة طويلة كافية للاختيار.",
];
const cleaned = stripRepeatedLines(headerRepro);
check(
  "stripRepeatedLines: removes a header repeated on >= 4 pages",
  cleaned.slice(1).every((pageText) => !pageText.includes("Claude 5: كزميل عمل")),
);
check(
  "stripRepeatedLines: keeps each page's real distinct sentence",
  cleaned[2].includes("موضوع ثالث") && cleaned[4].includes("موضوع خامس"),
);
check("stripRepeatedLines: keeps the one non-repeated page untouched", cleaned[0].includes("الفصل الخامس"));

const headerReproAnalysis = buildLocalStructuralAnalysis(headerRepro, {});
const summaryLines = headerReproAnalysis.extractive_summary.map((item) => item.text);
check(
  "buildLocalStructuralAnalysis: extractive summary never repeats the stripped header as a sentence",
  !summaryLines.some((text) => text.trim() === "Claude 5: كزميل عمل"),
);

// --- V0.7.3: local search-inside-the-book (acceptance test #11) ---
const searchable = buildLocalStructuralAnalysis(
  [
    "الفصل الأول: مقدمة\nهذا النص يتحدث عن إدارة المعرفة في المؤسسات الحديثة بشكل عام.",
    "الفصل الثاني: التطبيق\nهنا نستعرض إدارة المعرفة في سياق عملي داخل فريق العمل اليومي.",
    "صفحة ختامية بلا صلة بالموضوع الأساسي المطروح سابقًا في الكتاب.",
  ],
  {},
);
check("buildLocalStructuralAnalysis: stores pages_text for search", Array.isArray(searchable.pages_text) && searchable.pages_text.length === 3);
const searchHits = searchInsideBook(searchable.pages_text, "إدارة المعرفة");
check("searchInsideBook: finds real matches with correct page numbers", searchHits.length === 2 && searchHits[0].page === 1 && searchHits[1].page === 2);
check("searchInsideBook: snippet actually contains the query", searchHits.every((hit) => hit.snippet.includes("إدارة المعرفة")));
check("searchInsideBook: no match returns an empty array, not an error", searchInsideBook(searchable.pages_text, "كلمة غير موجودة إطلاقًا").length === 0);
check("searchInsideBook: missing pages_text returns [] instead of throwing", searchInsideBook(undefined, "أي شيء").length === 0);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
