import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260901_0007_spl_reviewer_access_draft.sql", import.meta.url), "utf8");

for (const required of ["معاينة نسخة المستخدم", "نسخة المستخدم", "ReviewerPreview", "مرحبًا بك في المكتبة الشخصية الذكية", "الاستماع إلى الصوت المحفوظ", "التقييم والملاحظات"]) {
  if (!app.includes(required)) throw new Error(`Reviewer preview is missing: ${required}`);
}
for (const required of ["const visibleBooks = books;", "isBookArchived(book)", "سؤال للنقاش مع المستخدم", "نسخة معرفية مؤرشفة", "هذه المعاينة ليست دليلًا", "افتح الكتاب الأصلي في قارئ المالك"]) {
  const start = app.indexOf("function ReviewerPreview");
  const end = app.indexOf("function LibraryLogin", start);
  if (!app.slice(start, end).includes(required)) throw new Error(`Reviewer research preview is missing: ${required}`);
}
for (const required of ['supervisorRoute', 'window.location.pathname}?supervisor=1', 'reviewer-standalone', 'تسجيل الخروج']) {
  if (!app.includes(required)) throw new Error(`Standalone supervisor route is missing: ${required}`);
}
const preview = app.slice(app.indexOf("function ReviewerPreview"), app.indexOf("function LibraryLogin", app.indexOf("function ReviewerPreview")));
if (preview.includes("العودة إلى حساب المالك")) throw new Error("Supervisor preview must not link back to owner account");
for (const forbidden of ["onUpload={", "invokeBookAI("]) {
  const start = app.indexOf("function ReviewerPreview");
  const end = app.indexOf("function LibraryLogin", start);
  if (app.slice(start, end > start ? end : undefined).includes(forbidden)) throw new Error(`Reviewer preview contains owner/paid action: ${forbidden}`);
}
for (const required of ["DRAFT ONLY", "spl_review_invites", "spl_book_shares", "spl_reviewer_feedback", "enable row level security", "spl_books_reviewer_select", "spl_storage_reviewer_select"]) {
  if (!migration.includes(required)) throw new Error(`Reviewer migration is missing: ${required}`);
}
console.log("Reviewer preview and draft access-policy verification passed.");
