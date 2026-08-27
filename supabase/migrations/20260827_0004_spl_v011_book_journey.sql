-- Smart Personal Library V0.11 — Book Journey + reminder infrastructure.
-- Additive only. Review before applying. No existing table/column is dropped or renamed.

begin;

create table if not exists public.spl_book_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.spl_books(id) on delete cascade,
  remind_at timestamptz not null,
  enabled boolean not null default true,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, book_id)
);

create index if not exists spl_book_reminders_due_idx
  on public.spl_book_reminders (enabled, remind_at)
  where enabled = true;

alter table public.spl_book_reminders enable row level security;

drop policy if exists "spl_book_reminders_select_own" on public.spl_book_reminders;
create policy "spl_book_reminders_select_own" on public.spl_book_reminders
  for select using (auth.uid() = user_id);
drop policy if exists "spl_book_reminders_insert_own" on public.spl_book_reminders;
create policy "spl_book_reminders_insert_own" on public.spl_book_reminders
  for insert with check (auth.uid() = user_id);
drop policy if exists "spl_book_reminders_update_own" on public.spl_book_reminders;
create policy "spl_book_reminders_update_own" on public.spl_book_reminders
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "spl_book_reminders_delete_own" on public.spl_book_reminders;
create policy "spl_book_reminders_delete_own" on public.spl_book_reminders
  for delete using (auth.uid() = user_id);

create table if not exists public.spl_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, endpoint)
);

create index if not exists spl_push_subscriptions_user_idx
  on public.spl_push_subscriptions (user_id)
  where enabled = true;

alter table public.spl_push_subscriptions enable row level security;

drop policy if exists "spl_push_subscriptions_select_own" on public.spl_push_subscriptions;
create policy "spl_push_subscriptions_select_own" on public.spl_push_subscriptions
  for select using (auth.uid() = user_id);
drop policy if exists "spl_push_subscriptions_insert_own" on public.spl_push_subscriptions;
create policy "spl_push_subscriptions_insert_own" on public.spl_push_subscriptions
  for insert with check (auth.uid() = user_id);
drop policy if exists "spl_push_subscriptions_update_own" on public.spl_push_subscriptions;
create policy "spl_push_subscriptions_update_own" on public.spl_push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "spl_push_subscriptions_delete_own" on public.spl_push_subscriptions;
create policy "spl_push_subscriptions_delete_own" on public.spl_push_subscriptions
  for delete using (auth.uid() = user_id);

commit;
