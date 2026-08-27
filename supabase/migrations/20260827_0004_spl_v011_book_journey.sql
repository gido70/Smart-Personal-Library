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

-- Claim due reminders atomically before dispatch. Concurrent cron invocations
-- cannot receive the same row because the selection is locked with SKIP LOCKED
-- and the reminder is marked consumed in the same transaction.
create or replace function public.spl_claim_due_book_reminders(
  p_claimed_at timestamptz default now(),
  p_limit integer default 100
)
returns table (
  id uuid,
  user_id uuid,
  book_id uuid,
  remind_at timestamptz,
  book_title text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select reminder.id
    from public.spl_book_reminders as reminder
    where reminder.enabled = true
      and reminder.last_sent_at is null
      and reminder.remind_at <= p_claimed_at
    order by reminder.remind_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 100))
  ), claimed as (
    update public.spl_book_reminders as reminder
    set last_sent_at = p_claimed_at,
        enabled = false,
        updated_at = p_claimed_at
    from due
    where reminder.id = due.id
    returning reminder.id, reminder.user_id, reminder.book_id, reminder.remind_at
  )
  select claimed.id, claimed.user_id, claimed.book_id, claimed.remind_at, book.title
  from claimed
  join public.spl_books as book on book.id = claimed.book_id;
end;
$$;

revoke all on function public.spl_claim_due_book_reminders(timestamptz, integer) from public;
revoke all on function public.spl_claim_due_book_reminders(timestamptz, integer) from anon;
revoke all on function public.spl_claim_due_book_reminders(timestamptz, integer) from authenticated;
grant execute on function public.spl_claim_due_book_reminders(timestamptz, integer) to service_role;

-- Abort before commit if the additive objects, RLS, or atomic claim function
-- are missing. This block performs no user-data mutation.
do $$
begin
  if to_regclass('public.spl_book_reminders') is null
     or to_regclass('public.spl_push_subscriptions') is null then
    raise exception 'V0.11 verification failed: reminder tables are missing';
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'spl_book_reminders' and c.relrowsecurity
  ) or not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'spl_push_subscriptions' and c.relrowsecurity
  ) then
    raise exception 'V0.11 verification failed: RLS is not enabled';
  end if;

  if to_regprocedure('public.spl_claim_due_book_reminders(timestamptz,integer)') is null then
    raise exception 'V0.11 verification failed: atomic reminder claim function is missing';
  end if;
end $$;

commit;
