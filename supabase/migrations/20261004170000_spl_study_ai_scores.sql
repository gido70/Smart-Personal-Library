-- AI scoring suggestions (protocol docs/study/scoring-protocol-v1.0.md). Written only by the spl-study-score
-- edge function (service role) after it verifies the caller is a researcher. The researcher's final decision
-- stays in spl_study_scores; agreement between the two is the reliability evidence.
create table if not exists public.spl_study_ai_scores (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.spl_study_participants(id) on delete cascade,
  instrument_key text not null check (instrument_key in ('post','followup')),
  item_code text not null check (item_code ~ '^[A-Z0-9_]{2,40}$'),
  score smallint check (score between 0 and 2),
  error_code text check (error_code in ('E','P')),
  confidence text check (confidence in ('high','medium','low')),
  rationale text,
  evidence_page text,
  evidence_quote text,
  model text,
  protocol_version text not null default '1.0',
  created_at timestamptz not null default now(),
  unique (participant_id, instrument_key, item_code, protocol_version)
);
alter table public.spl_study_ai_scores enable row level security;
drop policy if exists spl_study_ai_scores_researcher_read on public.spl_study_ai_scores;
create policy spl_study_ai_scores_researcher_read on public.spl_study_ai_scores
  for select to authenticated using (public.spl_study_is_researcher());
revoke all on public.spl_study_ai_scores from anon;
grant select on public.spl_study_ai_scores to authenticated;

-- Token log for scoring runs (spl_ai_usage only accepts process/ask/audio, so scoring is logged here).
create table if not exists public.spl_study_ai_runs (
  id bigint generated always as identity primary key,
  participant_id uuid references public.spl_study_participants(id) on delete set null,
  instrument_key text, model text, input_tokens integer, output_tokens integer,
  researcher_id uuid, created_at timestamptz not null default now()
);
alter table public.spl_study_ai_runs enable row level security;
drop policy if exists spl_study_ai_runs_researcher_read on public.spl_study_ai_runs;
create policy spl_study_ai_runs_researcher_read on public.spl_study_ai_runs for select to authenticated using (public.spl_study_is_researcher());
revoke all on public.spl_study_ai_runs from anon;
grant select on public.spl_study_ai_runs to authenticated;

-- Fix: voice previews were counted from spl_ai_usage, which rejects 'audio_preview' rows, so the preview limit
-- never applied. Count successful preview requests from spl_ai_requests instead. Same function otherwise.
create or replace function public.spl_study_ai_allowance(p_book uuid, p_action text, p_language text default null, p_voice text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); p public.spl_study_participants%rowtype; s spl_study_private.settings%rowtype; n integer;
begin
  select * into p from public.spl_study_participants where user_id = uid;
  if not found then return jsonb_build_object('ok',false,'error','NOT_PARTICIPANT'); end if;
  if p.status <> 'using' then return jsonb_build_object('ok',false,'error','STUDY_STAGE_CLOSED'); end if;
  if p.book_id is distinct from p_book then return jsonb_build_object('ok',false,'error','NOT_STUDY_BOOK'); end if;
  select * into s from spl_study_private.settings where id;
  if p.ai_approved_at is null then return jsonb_build_object('ok',false,'error','AWAITING_APPROVAL'); end if;
  if not s.ai_enabled then return jsonb_build_object('ok',false,'error','STUDY_AI_PAUSED'); end if;
  if coalesce(p.book_pages, s.max_pages + 1) > s.max_pages then return jsonb_build_object('ok',false,'error','BOOK_TOO_LONG'); end if;
  if p_action = 'process' then
    select count(*) into n from public.spl_ai_usage where user_id = uid and action = 'process';
    if n >= s.max_process then return jsonb_build_object('ok',false,'error','STUDY_LIMIT_PROCESS'); end if;
  elsif p_action = 'ask' then
    select count(*) into n from public.spl_questions where user_id = uid;
    if n >= s.max_asks then return jsonb_build_object('ok',false,'error','STUDY_LIMIT_ASK'); end if;
  elsif p_action = 'audio' then
    if not exists (select 1 from public.spl_audio_outputs a where a.user_id = uid and a.language = p_language and a.voice = p_voice) then
      select count(*) into n from (select distinct a.language, a.voice from public.spl_audio_outputs a where a.user_id = uid) t;
      if n >= s.max_audio_sets then return jsonb_build_object('ok',false,'error','STUDY_LIMIT_AUDIO'); end if;
    end if;
  elsif p_action = 'audio_preview' then
    select count(*) into n from public.spl_ai_requests where user_id = uid and action = 'audio_preview' and status = 'succeeded';
    if n >= s.max_previews then return jsonb_build_object('ok',false,'error','STUDY_LIMIT_PREVIEW'); end if;
  else
    return jsonb_build_object('ok',false,'error','ACTION_NOT_ALLOWED');
  end if;
  return jsonb_build_object('ok',true,'role','participant');
end; $$;
