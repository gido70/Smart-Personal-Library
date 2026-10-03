-- SPL study, phase (A): participants, consent, questionnaires, usage events.
-- DRAFT 0.1 — review before running. Idempotent where practical.
-- Access model:
--   * Participant: anonymous Supabase session + invite code (no email). Sees/writes only own rows.
--   * Researcher: user_id listed in spl_study_private.researchers. Sees everything, writes invites/instruments.
--   * Responses are insert-only for participants (locked after submit).

create extension if not exists pgcrypto with schema extensions;

-- ---------- private schema (not exposed to anon/authenticated) ----------
create schema if not exists spl_study_private;
revoke all on schema spl_study_private from public, anon, authenticated;

create table if not exists spl_study_private.researchers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

create table if not exists spl_study_private.join_attempts (
  user_id uuid primary key,
  window_start timestamptz not null default now(),
  attempts integer not null default 0
);

alter table spl_study_private.researchers enable row level security;
alter table spl_study_private.join_attempts enable row level security;
revoke all on all tables in schema spl_study_private from public, anon, authenticated;

create or replace function public.spl_study_is_researcher()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from spl_study_private.researchers r where r.user_id = auth.uid());
$$;
revoke all on function public.spl_study_is_researcher() from public, anon;
grant execute on function public.spl_study_is_researcher() to authenticated;

-- ---------- tables ----------
create table if not exists public.spl_study_participants (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^(P|T)-[0-9]{3}$'),        -- P-001 real, T-001 test
  invite_hash text not null unique check (invite_hash ~ '^[a-f0-9]{64}$'),
  is_test boolean not null default false,
  user_id uuid unique references auth.users(id) on delete set null,
  status text not null default 'invited'
    check (status in ('invited','consented','pre_done','using','post_done','followup_done','withdrawn')),
  consent_version text,
  consented_at timestamptz,
  interview_ok boolean,
  book_id uuid references public.spl_books(id) on delete set null,
  use_started_at timestamptz,
  post_due_at timestamptz,
  followup_due_at timestamptz,
  rebind_count integer not null default 0,
  withdrawn_at timestamptz,
  joined_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.spl_study_instruments (
  key text not null check (key in ('consent','pre','post','followup')),
  version text not null,
  title text not null,
  definition jsonb not null,           -- sections/items/types; edited without code changes
  active boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (key, version)
);
create unique index if not exists spl_study_instruments_one_active
  on public.spl_study_instruments (key) where active;

create table if not exists public.spl_study_responses (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.spl_study_participants(id) on delete cascade,
  instrument_key text not null,
  instrument_version text not null,
  answers jsonb not null,
  attention_passed boolean,
  started_at timestamptz,
  submitted_at timestamptz not null default now(),
  unique (participant_id, instrument_key),
  foreign key (instrument_key, instrument_version) references public.spl_study_instruments(key, version)
);

create table if not exists public.spl_study_events (
  id bigint generated always as identity primary key,
  participant_id uuid not null references public.spl_study_participants(id) on delete cascade,
  book_id uuid references public.spl_books(id) on delete set null,
  session_id uuid,
  event_type text not null check (event_type in (
    'session_start','session_end','view_summary','view_map','view_chapters','view_questions',
    'question_answer','audio_play','audio_progress','open_original','jump_to_page')),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists spl_study_events_participant_idx on public.spl_study_events (participant_id, occurred_at);

-- helper: current participant id for this session
create or replace function public.spl_study_my_participant()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.spl_study_participants p where p.user_id = auth.uid() and p.status <> 'withdrawn';
$$;
revoke all on function public.spl_study_my_participant() from public, anon;
grant execute on function public.spl_study_my_participant() to authenticated;

-- ---------- RLS ----------
alter table public.spl_study_participants enable row level security;
alter table public.spl_study_instruments enable row level security;
alter table public.spl_study_responses enable row level security;
alter table public.spl_study_events enable row level security;

drop policy if exists spl_study_participants_self_select on public.spl_study_participants;
create policy spl_study_participants_self_select on public.spl_study_participants
  for select to authenticated using (user_id = auth.uid());
drop policy if exists spl_study_participants_researcher_all on public.spl_study_participants;
create policy spl_study_participants_researcher_all on public.spl_study_participants
  for all to authenticated using (public.spl_study_is_researcher()) with check (public.spl_study_is_researcher());

drop policy if exists spl_study_instruments_read_active on public.spl_study_instruments;
create policy spl_study_instruments_read_active on public.spl_study_instruments
  for select to authenticated using (active);
drop policy if exists spl_study_instruments_researcher_all on public.spl_study_instruments;
create policy spl_study_instruments_researcher_all on public.spl_study_instruments
  for all to authenticated using (public.spl_study_is_researcher()) with check (public.spl_study_is_researcher());

drop policy if exists spl_study_responses_self_select on public.spl_study_responses;
create policy spl_study_responses_self_select on public.spl_study_responses
  for select to authenticated using (participant_id = public.spl_study_my_participant());
drop policy if exists spl_study_responses_researcher_select on public.spl_study_responses;
create policy spl_study_responses_researcher_select on public.spl_study_responses
  for select to authenticated using (public.spl_study_is_researcher());
drop policy if exists spl_study_responses_researcher_delete on public.spl_study_responses;
create policy spl_study_responses_researcher_delete on public.spl_study_responses
  for delete to authenticated using (public.spl_study_is_researcher());
-- no insert/update policy for participants: submission goes through spl_study_submit()

drop policy if exists spl_study_events_self_insert on public.spl_study_events;
create policy spl_study_events_self_insert on public.spl_study_events
  for insert to authenticated with check (participant_id = public.spl_study_my_participant());
drop policy if exists spl_study_events_researcher_select on public.spl_study_events;
create policy spl_study_events_researcher_select on public.spl_study_events
  for select to authenticated using (public.spl_study_is_researcher());
drop policy if exists spl_study_events_researcher_delete on public.spl_study_events;
create policy spl_study_events_researcher_delete on public.spl_study_events
  for delete to authenticated using (public.spl_study_is_researcher());

revoke all on public.spl_study_participants, public.spl_study_instruments,
  public.spl_study_responses, public.spl_study_events from anon;
grant select, insert, update, delete on public.spl_study_participants, public.spl_study_instruments to authenticated;
grant select, delete on public.spl_study_responses to authenticated;
grant select, insert, delete on public.spl_study_events to authenticated;

-- ---------- participant RPCs ----------
-- Join with invite code. Binds the current (anonymous) session to the participant.
-- Re-entering the code on a new device rebinds (counted in rebind_count).
create or replace function public.spl_study_join(p_invite text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); att spl_study_private.join_attempts%rowtype; p public.spl_study_participants%rowtype;
begin
  if uid is null then return jsonb_build_object('ok',false,'error','NO_SESSION'); end if;
  insert into spl_study_private.join_attempts(user_id) values (uid) on conflict (user_id) do nothing;
  select * into att from spl_study_private.join_attempts where user_id = uid for update;
  if att.window_start < now() - interval '15 minutes' then
    update spl_study_private.join_attempts set window_start = now(), attempts = 0 where user_id = uid; att.attempts := 0;
  end if;
  if att.attempts >= 10 then return jsonb_build_object('ok',false,'error','TOO_MANY_ATTEMPTS'); end if;
  update spl_study_private.join_attempts set attempts = attempts + 1 where user_id = uid;

  select * into p from public.spl_study_participants
   where invite_hash = encode(extensions.digest(upper(trim(coalesce(p_invite,''))), 'sha256'), 'hex') for update;
  if not found then return jsonb_build_object('ok',false,'error','INVALID_CODE'); end if;
  if p.status = 'withdrawn' then return jsonb_build_object('ok',false,'error','WITHDRAWN'); end if;

  if p.user_id is distinct from uid then
    update public.spl_study_participants set user_id = null where user_id = uid and id <> p.id; -- one participant per session
    update public.spl_study_participants
       set user_id = uid,
           rebind_count = rebind_count + case when p.user_id is null then 0 else 1 end,
           joined_at = coalesce(joined_at, now())
     where id = p.id;
  end if;
  update spl_study_private.join_attempts set attempts = 0 where user_id = uid;
  return jsonb_build_object('ok',true,'code',p.code,'status',p.status);
end; $$;

create or replace function public.spl_study_consent(p_version text, p_interview boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pid uuid := public.spl_study_my_participant();
begin
  if pid is null then return jsonb_build_object('ok',false,'error','NOT_JOINED'); end if;
  update public.spl_study_participants
     set status = 'consented', consent_version = p_version, consented_at = now(), interview_ok = coalesce(p_interview,false)
   where id = pid and status = 'invited';
  return jsonb_build_object('ok',true);
end; $$;

-- Submit a questionnaire once. Enforces order and timing gates.
create or replace function public.spl_study_submit(p_key text, p_answers jsonb, p_started_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.spl_study_participants%rowtype; ver text; attn boolean;
begin
  select * into p from public.spl_study_participants where id = public.spl_study_my_participant() for update;
  if not found then return jsonb_build_object('ok',false,'error','NOT_JOINED'); end if;
  if jsonb_typeof(p_answers) <> 'object' then return jsonb_build_object('ok',false,'error','BAD_ANSWERS'); end if;

  if p_key = 'pre' and p.status <> 'consented' then return jsonb_build_object('ok',false,'error','WRONG_STAGE'); end if;
  if p_key = 'post' and (p.status <> 'using' or now() < p.post_due_at) then return jsonb_build_object('ok',false,'error','NOT_YET'); end if;
  if p_key = 'followup' and (p.status <> 'post_done' or now() < p.followup_due_at) then return jsonb_build_object('ok',false,'error','NOT_YET'); end if;
  if p_key not in ('pre','post','followup') then return jsonb_build_object('ok',false,'error','BAD_KEY'); end if;

  select version into ver from public.spl_study_instruments where key = p_key and active;
  if ver is null then return jsonb_build_object('ok',false,'error','NO_ACTIVE_INSTRUMENT'); end if;

  -- attention item: ATTN1 in pre, ATTN2 in post; expected value 2 ("لا أوافق")
  attn := case p_key when 'pre' then (p_answers->>'ATTN1') = '2'
                     when 'post' then (p_answers->>'ATTN2') = '2' else null end;

  insert into public.spl_study_responses(participant_id, instrument_key, instrument_version, answers, attention_passed, started_at)
  values (p.id, p_key, ver, p_answers, attn, p_started_at)
  on conflict (participant_id, instrument_key) do nothing;
  if not found then return jsonb_build_object('ok',false,'error','ALREADY_SUBMITTED'); end if;

  update public.spl_study_participants set
    status = case p_key when 'pre' then 'pre_done' when 'post' then 'post_done' else 'followup_done' end,
    followup_due_at = case when p_key = 'post' then now() + interval '14 days' else followup_due_at end
  where id = p.id;
  return jsonb_build_object('ok',true);
end; $$;

-- Link the participant's single study book (must belong to the same session). Starts the 7-day window.
create or replace function public.spl_study_link_book(p_book uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.spl_study_participants%rowtype;
begin
  select * into p from public.spl_study_participants where id = public.spl_study_my_participant() for update;
  if not found then return jsonb_build_object('ok',false,'error','NOT_JOINED'); end if;
  if p.status <> 'pre_done' then return jsonb_build_object('ok',false,'error','WRONG_STAGE'); end if;
  if not exists (select 1 from public.spl_books b where b.id = p_book and b.user_id = auth.uid()) then
    return jsonb_build_object('ok',false,'error','NOT_YOUR_BOOK');
  end if;
  update public.spl_study_participants
     set book_id = p_book, status = 'using', use_started_at = now(), post_due_at = now() + interval '7 days'
   where id = p.id;
  return jsonb_build_object('ok',true);
end; $$;

create or replace function public.spl_study_withdraw()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pid uuid := public.spl_study_my_participant();
begin
  if pid is null then return jsonb_build_object('ok',false,'error','NOT_JOINED'); end if;
  update public.spl_study_participants set status = 'withdrawn', withdrawn_at = now() where id = pid;
  return jsonb_build_object('ok',true);
end; $$;

-- ---------- researcher RPC ----------
-- Creates n invites and returns the plain codes ONCE (only hashes are stored).
create or replace function public.spl_study_create_invites(p_count integer, p_test boolean default false)
returns table(code text, invite text) language plpgsql security definer set search_path = '' as $$
declare i integer; prefix text := case when p_test then 'T' else 'P' end; n integer; inv text;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea;
begin
  if not public.spl_study_is_researcher() then raise exception 'NOT_RESEARCHER'; end if;
  if p_count < 1 or p_count > 100 then raise exception 'BAD_COUNT'; end if;
  select coalesce(max(substr(p.code,3)::int),0) into n from public.spl_study_participants p where p.code like prefix || '-%';
  for i in 1..p_count loop
    b := extensions.gen_random_bytes(10); inv := '';
    for j in 0..9 loop inv := inv || substr(alphabet, (get_byte(b,j) % 32) + 1, 1); end loop;
    n := n + 1; code := prefix || '-' || lpad(n::text,3,'0'); invite := inv;
    insert into public.spl_study_participants(code, invite_hash, is_test)
    values (code, encode(extensions.digest(inv,'sha256'),'hex'), p_test);
    return next;
  end loop;
end; $$;

do $$ declare f text; begin
  foreach f in array array['spl_study_join(text)','spl_study_consent(text,boolean)','spl_study_submit(text,jsonb,timestamptz)',
    'spl_study_link_book(uuid)','spl_study_withdraw()','spl_study_create_invites(integer,boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------- after running: register yourself as researcher (replace the email) ----------
-- insert into spl_study_private.researchers(user_id)
--   select id from auth.users where email = 'YOUR_OWNER_EMAIL' and coalesce(is_anonymous,false) = false
--   on conflict do nothing;
