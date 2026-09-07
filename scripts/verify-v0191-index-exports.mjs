import fs from "node:fs";

const app = fs.readFileSync("src/App.tsx", "utf8");
const lib = fs.readFileSync("src/lib/library.ts", "utf8");
const exportsSource = fs.readFileSync("src/lib/exports.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260907_0008_spl_author_title_indexes.sql", "utf8");
const css = fs.readFileSync("src/v0103.css", "utf8");

const checks = [
  [app.includes('"indexes"'), "indexes view is registered"],
  [app.includes("فهرس المؤلفين") && app.includes("فهرس العناوين"), "Arabic author and title indexes exist"],
  [app.includes("updateAuthorBiography") && app.includes("مؤلفات داخل مكتبتي"), "author biography and works UI exists"],
  [app.includes("catalog-author-link") && app.includes("onOpenAuthor"), "catalogue author opens the linked authority record"],
  [lib.includes("listLibraryAuthors") && lib.includes("syncBookAuthor"), "author authority data functions exist"],
  [migration.includes("create table if not exists public.spl_authors"), "persistent author table exists"],
  [migration.includes("create table if not exists public.spl_book_authors"), "book-author relation exists"],
  [migration.includes("references public.spl_books(id) on delete cascade"), "book deletion removes links without deleting authors"],
  [migration.includes("alter table public.spl_authors enable row level security"), "author RLS is enabled"],
  [migration.includes("b.user_id = auth.uid()") && !migration.includes("b.owner_id"), "author policies use the real spl_books user_id column"],
  [migration.includes("x.content->'metadata'->>'author'"), "existing AI-extracted authors are backfilled"],
  [exportsSource.includes("direction:${direction}") && exportsSource.includes("ctx.direction=rtl"), "Word and PDF exports enforce RTL"],
  [exportsSource.includes("application/msword") && exportsSource.includes("application/pdf"), "Word and PDF downloads exist"],
  [app.includes("downloadSavedAudio") && app.includes("تنزيل هذا الجزء"), "saved audio downloads exist"],
  [exportsSource.includes("الأسئلة والإجابات المحفوظة") && app.includes("questionHistory"), "saved questions are included in report downloads"],
  [!exportsSource.includes("original_file") && !exportsSource.includes("book.file"), "report downloads exclude the original book file"],
  [css.includes(".author-index-layout") && css.includes(".result-downloads"), "responsive index and export styles exist"],
];

const failed = checks.filter(([ok]) => !ok);
for (const [ok, label] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
if (failed.length) process.exit(1);
