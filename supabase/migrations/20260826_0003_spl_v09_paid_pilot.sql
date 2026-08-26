-- Smart Personal Library V0.9 — private paid pilot observability.
-- Additive only: no book, analysis, question, audio, or storage row is deleted.

begin;

create table if not exists public.spl_ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.spl_books(id) on delete cascade,
  action text not null check (action in ('process','ask','audio')),
  model text not null,
  input_tokens bigint check (input_tokens is null or input_tokens >= 0),
  output_tokens bigint check (output_tokens is null or output_tokens >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists spl_ai_usage_user_created_idx
  on public.spl_ai_usage(user_id, created_at desc);
create index if not exists spl_ai_usage_book_created_idx
  on public.spl_ai_usage(book_id, created_at desc);

alter table public.spl_ai_usage enable row level security;
drop policy if exists spl_ai_usage_owner_select on public.spl_ai_usage;
drop policy if exists spl_ai_usage_owner_insert on public.spl_ai_usage;
create policy spl_ai_usage_owner_select on public.spl_ai_usage
  for select to authenticated using (user_id = auth.uid());
create policy spl_ai_usage_owner_insert on public.spl_ai_usage
  for insert to authenticated with check (user_id = auth.uid());

commit;
