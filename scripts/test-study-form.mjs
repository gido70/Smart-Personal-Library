// Unit tests for the participant questionnaire logic (show_if, validation, cleaning)
// against the real instrument definitions committed in docs/study.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isVisible, validateSection, cleanAnswers, resolveOptions, wordCount } from "../src/study/formLogic.ts";

const instruments = Object.fromEntries(JSON.parse(readFileSync(new URL("../docs/study/instruments-v0.3.json", import.meta.url), "utf8")).map(i => [i.key, i]));
let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("PASS ", name); };
const section = (key, id) => instruments[key].sections.find(s => s.id === id);
const item = (key, code) => instruments[key].sections.flatMap(s => s.items ?? []).find(i => i.code === code);

ok("item counts match the document (4/33/48/7)", () => {
  const count = i => i.sections.reduce((n, s) => n + (s.items?.length ?? 0), 0) + (i.checks?.length ?? 0);
  assert.deepEqual(["consent", "pre", "post", "followup"].map(k => count(instruments[k])), [4, 33, 48, 7]);
});
ok("item codes are unique within each instrument", () => {
  for (const i of Object.values(instruments)) {
    const codes = i.sections.flatMap(s => (s.items ?? []).map(x => x.code));
    assert.equal(new Set(codes).size, codes.length, i.key);
  }
});
ok("rank appears only with 3+ reasons", () => {
  const rank = item("pre", "PRE_REASONS_TOP3");
  assert.equal(isVisible(rank, { PRE_REASONS: ["ضيق الوقت", "طول الكتاب"] }), false);
  assert.equal(isVisible(rank, { PRE_REASONS: ["ضيق الوقت", "طول الكتاب", "لغة الكتاب"] }), true);
});
ok("ne condition hides when unanswered and when equal", () => {
  const ret2 = item("post", "RET2");
  assert.equal(isVisible(ret2, {}), false);
  assert.equal(isVisible(ret2, { RET1: "لا مرة" }), false);
  assert.equal(isVisible(ret2, { RET1: "مرة" }), true);
});
ok("empty pre demo section reports required errors, optional gender excluded", () => {
  const errors = validateSection(section("pre", "demo"), {});
  assert.ok(errors.PRE_AGE && errors.PRE_COUNTRY && errors.PRE_EN);
  assert.equal(errors.PRE_GENDER, undefined);
});
ok("'other' requires its text", () => {
  const s = section("pre", "demo");
  const base = { PRE_AGE: "٢٥–٣٤", PRE_EDU: "بكالوريوس", PRE_COUNTRY: "الإمارات", PRE_L1: "العربية", PRE_EN: 3 };
  assert.ok(validateSection(s, { ...base, PRE_FIELD: "أخرى" }).PRE_FIELD);
  assert.deepEqual(validateSection(s, { ...base, PRE_FIELD: "أخرى", PRE_FIELD_OTHER: "مكتبات" }), {});
});
ok("page limit 1..400 enforced", () => {
  const s = section("pre", "book");
  assert.ok(validateSection(s, { PRE_BOOK_PAGES: 401 }).PRE_BOOK_PAGES);
  assert.equal(validateSection(s, { PRE_BOOK_PAGES: 250 }).PRE_BOOK_PAGES, undefined);
});
ok("understanding ideas need 10 words", () => {
  const s = section("post", "und");
  const short = validateSection(s, { UND_IDEA1: "فكرة قصيرة" });
  assert.match(short.UND_IDEA1, /10/);
  assert.equal(wordCount("واحد اثنان ثلاثة أربعة خمسة ستة سبعة ثمانية تسعة عشرة"), 10);
});
ok("pending SUS section is never validated or submitted", () => {
  assert.deepEqual(validateSection(section("post", "sus"), {}), {});
  const cleaned = cleanAnswers(instruments.post.sections, { SUS1: 4, UND_SELF: 3 });
  assert.equal(cleaned.SUS1, undefined);
  assert.equal(cleaned.UND_SELF, 3);
});
ok("COMP_BEST offers only used components and is skipped when none used", () => {
  const s = section("post", "comp");
  const best = item("post", "COMP_BEST");
  assert.deepEqual(resolveOptions(best, s, { COMP_SUM_USED: "نعم", COMP_MAP_USED: "لا", COMP_AUDIO_USED: "نعم" }), ["الخلاصة", "المقاطع الصوتية"]);
  const none = Object.fromEntries(s.items.filter(i => i.code.endsWith("_USED")).map(i => [i.code, "لا"]));
  assert.equal(validateSection(s, none).COMP_BEST, undefined);
});
ok("hidden answers are dropped on submit", () => {
  const cleaned = cleanAnswers(instruments.followup.sections, { FU_CITE: "لا", FU_CITE_SRC: "المنصة" });
  assert.equal(cleaned.FU_CITE_SRC, undefined);
});
ok("attention items expect 2 in pre and post", () => {
  assert.equal(item("pre", "ATTN1").attention, 2);
  assert.equal(item("post", "ATTN2").attention, 2);
});
console.log(`\n${passed} study form checks passed`);
