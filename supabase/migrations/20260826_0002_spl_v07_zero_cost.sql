-- Smart Personal Library V0.7 "Zero-Cost Functional Pilot" migration.
-- Review before execution. Do NOT run this automatically — the app degrades
-- gracefully (see src/lib/library.ts: isMissingColumnError/checkHashColumnAvailable)
-- when it has not been applied yet, so it is safe to review this file on its own
-- schedule. This migration only ADDS columns/constraints/indexes; it never drops
-- or renames an existing table or column. Existing analysis rows receive the
-- explicit provenance default 'openai'; content_sha256 remains NULL for old books.
--
-- Fixes bug (ج) from CLAUDE-AUDIT-REPORT.md: re-uploading the same file created a
-- duplicate spl_books row, because nothing on the server enforced uniqueness per
-- user+content. Also widens spl_analyses so the two new zero-cost analysis kinds
-- introduced in V0.7 (local_structural, manual_import) can be persisted alongside
-- the existing OpenAI-backed kinds without weakening any existing constraint.

begin;

-- ---------------------------------------------------------------------------
-- 1. Content-hash dedupe for spl_books (fixes bug ج)
-- ---------------------------------------------------------------------------

alter table public.spl_books
  add column if not exists content_sha256 text;

-- A plain UNIQUE(user_id, content_sha256) constraint would reject every row
-- with a NULL hash (pre-migration uploads, or uploads where client-side
-- hashing failed and fell through to a normal upload). A partial unique
-- index only enforces uniqueness once a hash is actually present, which is
-- exactly what src/lib/library.ts's uploadPilotBook() dedupe check relies on.
create unique index if not exists spl_books_user_content_hash_uidx
  on public.spl_books (user_id, content_sha256)
  where content_sha256 is not null;

-- ---------------------------------------------------------------------------
-- 2. Widen spl_analyses for the two new zero-cost analysis kinds
-- ---------------------------------------------------------------------------

-- kind: add 'local_structural' (free, on-device PDF.js pass) and
-- 'manual_import' (free, human-pasted ChatGPT/Claude JSON) alongside the
-- four existing OpenAI-backed kinds. The existing unique(book_id, kind,
-- language) constraint is untouched, so upsert(...,{onConflict:
-- "book_id,kind,language"}) in src/lib/library.ts continues to work
-- unmodified for both old and new kinds.
alter table public.spl_analyses
  drop constraint if exists spl_analyses_kind_check;
alter table public.spl_analyses
  add constraint spl_analyses_kind_check
  check (kind in ('overview','chapters','critical','metadata','local_structural','manual_import'));

-- source: which engine produced this row. Existing rows (and the untouched
-- spl-ai Edge Function, which never sets this column) default to 'openai',
-- so nothing that currently writes to spl_analyses needs to change.
alter table public.spl_analyses
  add column if not exists source text not null default 'openai';
alter table public.spl_analyses
  drop constraint if exists spl_analyses_source_check;
alter table public.spl_analyses
  add constraint spl_analyses_source_check
  check (source in ('openai','local_js','manual_chatgpt','manual_claude','manual_other'));

-- template_version: free-form version tag for the local-analysis / manual-
-- import payload shapes (see src/lib/textAnalysis.ts and
-- docs/manual-import-schema.md). Nullable — existing OpenAI rows leave it null.
alter table public.spl_analyses
  add column if not exists template_version text;

-- Fail the migration before commit if any required object is missing.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'spl_books' and column_name = 'content_sha256'
  ) then
    raise exception 'V0.7 verification failed: spl_books.content_sha256 is missing';
  end if;

  if to_regclass('public.spl_books_user_content_hash_uidx') is null then
    raise exception 'V0.7 verification failed: deduplication index is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'spl_analyses' and column_name = 'source'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'spl_analyses' and column_name = 'template_version'
  ) then
    raise exception 'V0.7 verification failed: spl_analyses metadata columns are missing';
  end if;
end $$;

-- Note: spl_reading_progress and spl_feedback already exist with the exact
-- shape src/lib/library.ts's getReadingProgress/saveReadingProgress/
-- saveFeedback expect (see 20260825_0001_spl_v05_pilot.sql), including RLS.
-- Nothing further is required for those two tables in this migration.

commit;
