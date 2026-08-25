-- Smart Personal Library V0.5 pilot, isolated inside the Al-Falah Supabase project.
-- Review before execution. All application tables use the spl_ prefix.

create extension if not exists pgcrypto;

create table if not exists public.spl_books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  file_name text not null,
  mime_type text not null default 'application/pdf',
  file_size bigint not null check (file_size > 0 and file_size <= 52428800),
  storage_path text not null unique,
  source_language text not null default 'unknown' check (source_language in ('ar','en','mixed','unknown')),
  output_language text not null default 'ar' check (output_language in ('ar','en','bilingual')),
  status text not null default 'uploaded' check (status in ('uploaded','processing','ready','failed')),
  openai_file_id text,
  processing_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.spl_legal_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.spl_books(id) on delete cascade,
  rights_owned boolean not null check (rights_owned),
  personal_use_only boolean not null check (personal_use_only),
  policy_version text not null,
  user_agent text,
  accepted_at timestamptz not null default now()
);

create table if not exists public.spl_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.spl_books(id) on delete cascade,
  kind text not null check (kind in ('overview','chapters','critical','metadata')),
  language text not null check (language in ('ar','en')),
  content jsonb not null,
  model text,
  created_at timestamptz not null default now(),
  unique (book_id, kind, language)
);

create table if not exists public.spl_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.spl_books(id) on delete cascade,
  question text not null,
  answer jsonb not null,
  language text not null check (language in ('ar','en')),
  model text,
  created_at timestamptz not null default now()
);

create table if not exists public.spl_audio_outputs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.spl_books(id) on delete cascade,
  analysis_id uuid references public.spl_analyses(id) on delete cascade,
  language text not null check (language in ('ar','en')),
  voice text not null,
  part_no smallint not null default 1 check (part_no > 0),
  storage_path text not null unique,
  duration_seconds integer,
  created_at timestamptz not null default now()
);

create table if not exists public.spl_reading_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.spl_books(id) on delete cascade,
  page integer not null default 1 check (page > 0),
  bookmarks integer[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

create table if not exists public.spl_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid references public.spl_books(id) on delete set null,
  feature text not null,
  rating smallint check (rating between 1 and 5),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists spl_books_user_created_idx on public.spl_books(user_id, created_at desc);
create index if not exists spl_analyses_book_idx on public.spl_analyses(book_id);
create index if not exists spl_questions_book_idx on public.spl_questions(book_id, created_at desc);

alter table public.spl_books enable row level security;
alter table public.spl_legal_consents enable row level security;
alter table public.spl_analyses enable row level security;
alter table public.spl_questions enable row level security;
alter table public.spl_audio_outputs enable row level security;
alter table public.spl_reading_progress enable row level security;
alter table public.spl_feedback enable row level security;

do $$
declare t text;
begin
  foreach t in array array['spl_books','spl_legal_consents','spl_analyses','spl_questions','spl_audio_outputs','spl_reading_progress','spl_feedback']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_owner_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_owner_all', t);
  end loop;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('spl-books', 'spl-books', false, 52428800, array['application/pdf','application/epub+zip'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('spl-audio', 'spl-audio', false, 52428800, array['audio/mpeg','audio/wav','audio/ogg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists spl_storage_owner_select on storage.objects;
drop policy if exists spl_storage_owner_insert on storage.objects;
drop policy if exists spl_storage_owner_update on storage.objects;
drop policy if exists spl_storage_owner_delete on storage.objects;

create policy spl_storage_owner_select on storage.objects for select to authenticated
using (bucket_id in ('spl-books','spl-audio') and (storage.foldername(name))[1] = auth.uid()::text);
create policy spl_storage_owner_insert on storage.objects for insert to authenticated
with check (bucket_id in ('spl-books','spl-audio') and (storage.foldername(name))[1] = auth.uid()::text);
create policy spl_storage_owner_update on storage.objects for update to authenticated
using (bucket_id in ('spl-books','spl-audio') and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id in ('spl-books','spl-audio') and (storage.foldername(name))[1] = auth.uid()::text);
create policy spl_storage_owner_delete on storage.objects for delete to authenticated
using (bucket_id in ('spl-books','spl-audio') and (storage.foldername(name))[1] = auth.uid()::text);
