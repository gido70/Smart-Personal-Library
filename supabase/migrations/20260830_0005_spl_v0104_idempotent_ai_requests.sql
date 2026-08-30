-- V0.10.4 additive paid-operation safety.
-- Prepared for review only: applying this migration is a separate production step.

begin;

create table if not exists public.spl_ai_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.spl_books(id) on delete cascade,
  action text not null check (action in ('process','ask','audio','audio_preview')),
  idempotency_key text not null,
  status text not null default 'processing' check (status in ('processing','succeeded','failed')),
  http_status integer,
  result jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, idempotency_key)
);

create index if not exists spl_ai_requests_book_created_idx
  on public.spl_ai_requests (book_id, created_at desc);

alter table public.spl_ai_requests enable row level security;

drop policy if exists "spl_ai_requests_owner_select" on public.spl_ai_requests;
create policy "spl_ai_requests_owner_select" on public.spl_ai_requests
  for select using (auth.uid() = user_id);

drop policy if exists "spl_ai_requests_owner_insert" on public.spl_ai_requests;
create policy "spl_ai_requests_owner_insert" on public.spl_ai_requests
  for insert with check (auth.uid() = user_id);

drop policy if exists "spl_ai_requests_owner_update" on public.spl_ai_requests;
create policy "spl_ai_requests_owner_update" on public.spl_ai_requests
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.spl_ai_requests is
  'Owner-scoped idempotency receipts for paid SPL actions; prevents repeated OpenAI spending after double-clicks or interrupted responses.';

-- The browser and the private Storage bucket must enforce the same independent
-- 30 MB file limit. The 500-page limit remains a PDF.js acceptance check.
update storage.buckets
set file_size_limit = 31457280
where id = 'spl-books';

commit;
