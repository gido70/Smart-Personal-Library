-- V0.10.3 real book reminders. Additive only; creates no cron job and calls no URL.
-- The separate scheduler setup must be reviewed against cron.job before activation.
begin;

create table if not exists public.spl_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create table if not exists public.spl_book_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.spl_books(id) on delete cascade,
  remind_at timestamptz not null,
  timezone text not null default 'UTC',
  enabled boolean not null default true,
  claimed_at timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 3),
  last_sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, book_id)
);

create index if not exists spl_book_reminders_due_idx
  on public.spl_book_reminders (remind_at)
  where enabled = true;

alter table public.spl_push_subscriptions enable row level security;
alter table public.spl_book_reminders enable row level security;

drop policy if exists spl_push_subscriptions_owner_all on public.spl_push_subscriptions;
create policy spl_push_subscriptions_owner_all
on public.spl_push_subscriptions
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists spl_book_reminders_owner_all on public.spl_book_reminders;
create policy spl_book_reminders_owner_all
on public.spl_book_reminders
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create or replace function public.spl_claim_due_book_reminders(p_limit integer default 25)
returns table (
  id uuid,
  user_id uuid,
  book_id uuid,
  remind_at timestamptz,
  attempts integer
)
language sql
security definer
set search_path = public
as $$
  with due as (
    select reminder.id
    from public.spl_book_reminders reminder
    where reminder.enabled = true
      and reminder.remind_at <= now()
      and reminder.attempts < 3
      and (reminder.claimed_at is null or reminder.claimed_at < now() - interval '10 minutes')
    order by reminder.remind_at
    for update skip locked
    limit least(greatest(p_limit, 1), 25)
  )
  update public.spl_book_reminders reminder
  set claimed_at = now(),
      attempts = reminder.attempts + 1,
      updated_at = now()
  from due
  where reminder.id = due.id
  returning reminder.id, reminder.user_id, reminder.book_id, reminder.remind_at, reminder.attempts;
$$;

revoke all on function public.spl_claim_due_book_reminders(integer) from public, anon, authenticated;
grant execute on function public.spl_claim_due_book_reminders(integer) to service_role;

do $$
declare
  missing text[] := array[]::text[];
begin
  if to_regclass('public.spl_push_subscriptions') is null then missing := array_append(missing, 'spl_push_subscriptions'); end if;
  if to_regclass('public.spl_book_reminders') is null then missing := array_append(missing, 'spl_book_reminders'); end if;
  if not exists (select 1 from pg_class where oid = 'public.spl_push_subscriptions'::regclass and relrowsecurity) then missing := array_append(missing, 'push RLS'); end if;
  if not exists (select 1 from pg_class where oid = 'public.spl_book_reminders'::regclass and relrowsecurity) then missing := array_append(missing, 'reminder RLS'); end if;
  if to_regprocedure('public.spl_claim_due_book_reminders(integer)') is null then missing := array_append(missing, 'claim function'); end if;
  if array_length(missing, 1) is not null then
    raise exception 'V0103 reminder migration verification failed: %', array_to_string(missing, ', ');
  end if;
end $$;

commit;
