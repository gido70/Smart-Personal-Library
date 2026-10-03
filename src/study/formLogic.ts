import type { Answers, AnswerValue, Item, Section } from "./types";

export const OTHER = "أخرى";
export const NA = "NA";

export function isEmpty(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Whether an item is shown, given current answers. Unanswered conditions hide the item. */
export function isVisible(item: Item, answers: Answers): boolean {
  const rule = item.show_if;
  if (!rule) return true;
  const value = answers[rule.code];
  if (rule.min_count !== undefined) return Array.isArray(value) && value.length >= rule.min_count;
  if (isEmpty(value)) return false;
  if (rule.eq !== undefined) return value === rule.eq;
  if (rule.ne !== undefined) return value !== rule.ne;
  return true;
}

/** Options for items that depend on other answers (rank, options_from_used). */
export function resolveOptions(item: Item, section: Section, answers: Answers): string[] {
  if (item.type === "rank" && item.from_code) {
    const chosen = answers[item.from_code];
    return Array.isArray(chosen) ? chosen : [];
  }
  if (item.options_from_used) {
    const usedItems = (section.items ?? []).filter(other => other.code.endsWith("_USED"));
    return item.options_from_used.filter((_, index) => answers[usedItems[index]?.code ?? ""] === "نعم");
  }
  return item.options ?? [];
}

/** Returns an Arabic error message for the item, or null when valid. */
export function validateItem(item: Item, section: Section, answers: Answers): string | null {
  if (!isVisible(item, answers)) return null;
  if (item.options_from_used && resolveOptions(item, section, answers).length === 0) return null;
  const value = answers[item.code];
  if (isEmpty(value)) return item.required ? "هذا السؤال مطلوب." : null;
  if (item.type === "text" && typeof value === "string" && item.min_words && wordCount(value) < item.min_words) {
    return `اكتب ${item.min_words} كلمات على الأقل (كتبت ${wordCount(value)}).`;
  }
  if (item.type === "number") {
    const n = Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return "اكتب رقمًا صحيحًا.";
    if (item.min !== undefined && n < item.min) return `الحد الأدنى ${item.min}.`;
    if (item.max !== undefined && n > item.max) return `الحد الأقصى ${item.max}.`;
  }
  if (item.type === "rank") {
    const pick = Math.min(item.pick ?? 3, resolveOptions(item, section, answers).length);
    const ranked = Array.isArray(value) ? value.filter(Boolean) : [];
    if (ranked.length < pick) return `اختر ${pick} أسباب مرتبة.`;
    if (new Set(ranked).size !== ranked.length) return "لا تكرر السبب نفسه.";
  }
  if (item.other) {
    const selected = Array.isArray(value) ? value.includes(OTHER) : value === OTHER;
    if (selected && isEmpty(answers[`${item.code}_OTHER`])) return "حدد ما تقصده بـ«أخرى».";
  }
  return null;
}

export function validateSection(section: Section, answers: Answers): Record<string, string> {
  const errors: Record<string, string> = {};
  if (section.pending) return errors;
  for (const item of section.items ?? []) {
    const error = validateItem(item, section, answers);
    if (error) errors[item.code] = error;
  }
  return errors;
}

/** Keeps only answers to visible items of non-pending sections (plus their _OTHER texts). */
export function cleanAnswers(sections: Section[], answers: Answers): Answers {
  const clean: Answers = {};
  for (const section of sections) {
    if (section.pending) continue;
    for (const item of section.items ?? []) {
      if (!isVisible(item, answers)) continue;
      const value = answers[item.code];
      if (isEmpty(value)) continue;
      clean[item.code] = value;
      const other = answers[`${item.code}_OTHER`];
      const selectedOther = Array.isArray(value) ? value.includes(OTHER) : value === OTHER;
      if (item.other && selectedOther && !isEmpty(other)) clean[`${item.code}_OTHER`] = other;
    }
  }
  return clean;
}

export function studyErrorMessage(code: string | undefined): string {
  switch (code) {
    case "INVALID_CODE": return "الرمز غير صحيح. تأكد منه وأعد المحاولة.";
    case "TOO_MANY_ATTEMPTS": return "محاولات كثيرة. انتظر ١٥ دقيقة ثم أعد المحاولة.";
    case "WITHDRAWN": return "هذا الرمز لمشارك انسحب من الدراسة.";
    case "NO_SESSION": return "تعذر بدء الجلسة. أعد تحميل الصفحة.";
    case "NOT_JOINED": return "انتهت الجلسة. أدخل رمزك مرة أخرى.";
    case "WRONG_STAGE": return "هذه الخطوة غير متاحة في مرحلتك الحالية. أعد تحميل الصفحة.";
    case "NOT_YET": return "لم يحن موعد هذا الاستبيان بعد.";
    case "ALREADY_SUBMITTED": return "أُرسل هذا الاستبيان من قبل.";
    case "NO_ACTIVE_INSTRUMENT": return "الاستبيان غير متاح الآن. تواصل مع الباحث.";
    case "NOT_YOUR_BOOK": return "هذا الكتاب غير مرتبط بجلستك.";
    case "anonymous_provider_disabled": return "الدخول غير مفعّل في الخادم. تواصل مع الباحث.";
    default: return "حدث خطأ غير متوقع. حاول مرة أخرى، وإن تكرر فتواصل مع الباحث.";
  }
}
