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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
