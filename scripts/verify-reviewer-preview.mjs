import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260901_0007_spl_reviewer_access_draft.sql", import.meta.url), "utf8");

for (const required of ["معاينة نسخة المشرف", "ReviewerPreview", "مرحبًا بك في المكتبة الشخصية الذكية", "الاستماع إلى الصوت المحفوظ", "التقييم والملاحظات"]) {
  if (!app.includes(required)) throw new Error(`Reviewer preview is missing: ${required}`);
}
for (const forbidden of ["onUpload={", "invokeBookAI("]) {
  const start = app.indexOf("function ReviewerPreview");
  const end = app.indexOf("function LibraryLogin", start);
  if (app.slice(start, end > start ? end : undefined).includes(forbidden)) throw new Error(`Reviewer preview contains owner/paid action: ${forbidden}`);
}
for (const required of ["DRAFT ONLY", "spl_review_invites", "spl_book_shares", "spl_reviewer_feedback", "enable row level security", "spl_books_reviewer_select", "spl_storage_reviewer_select"]) {
  if (!migration.includes(required)) throw new Error(`Reviewer migration is missing: ${required}`);
}
console.log("Reviewer preview and draft access-policy verification passed.");
