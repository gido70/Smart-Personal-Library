-- SPL study phase A, step 2b: participant access to paid AI on their single linked book.
-- Additive only. Owner (pilot e-mail) path in spl-ai is unchanged.

-- Study-wide limits and kill switch (researcher edits these rows; participants cannot read them).
create table if not exists spl_study_private.settings (
  id boolean primary key default true check (id),
  ai_enabled boolean not null default false,      -- master switch: false blocks every participant AI call
  max_pages integer not null default 400,
  max_process integer not null default 2,         -- overview analyses (allows one retry)
  max_asks integer not null default 40,           -- book questions per participant
  max_audio_sets integer not null default 2,      -- distinct language+voice full narrations
  max_previews integer not null default 8,        -- short voice previews
  updated_at timestamptz not null default now()
);
insert into spl_study_private.settings(id) values (true) on conflict (id) do nothing;
alter table spl_study_private.settings enable row level security;
revoke all on spl_study_private.settings from public, anon, authenticated;

-- Page count is snapshotted when the book is linked, so later catalogue edits cannot change it.
alter table public.spl_study_participants add column if not exists book_pages integer;

create or replace function public.spl_study_link_book(p_book uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.spl_study_participants%rowtype; s spl_study_private.settings%rowtype; pages integer; raw text;
begin
  select * into p from public.spl_study_participants where id = public.spl_study_my_participant() for update;
  if not found then return jsonb_build_object('ok',false,'error','NOT_JOINED'); end if;
  if p.status <> 'pre_done' then return jsonb_build_object('ok',false,'error','WRONG_STAGE'); end if;
  select b.metadata->>'page_count' into raw from public.spl_books b where b.id = p_book and b.user_id = auth.uid();
  if not found then return jsonb_build_object('ok',false,'error','NOT_YOUR_BOOK'); end if;
  if raw is null or raw !~ '^[0-9]{1,6}$' then return jsonb_build_object('ok',false,'error','PAGES_UNKNOWN'); end if;
  pages := raw::integer;
  select * into s from spl_study_private.settings where id;
  if pages < 1 or pages > s.max_pages then
    return jsonb_build_object('ok',false,'error','BOOK_TOO_LONG','pages',pages,'max',s.max_pages);
  end if;
  update public.spl_study_participants
     set book_id = p_book, book_pages = pages, status = 'using', use_started_at = now(), post_due_at = now() + interval '7 days'
   where id = p.id;
  return jsonb_build_object('ok',true,'pages',pages);
end; $$;

-- Called by spl-ai (with the participant's own JWT) before any paid call.
create or replace function public.spl_study_ai_allowance(p_book uuid, p_action text, p_language text default null, p_voice text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); p public.spl_study_participants%rowtype; s spl_study_private.settings%rowtype; n integer;
begin
  select * into p from public.spl_study_participants where user_id = uid;
  if not found then return jsonb_build_object('ok',false,'error','NOT_PARTICIPANT'); end if;
  if p.status <> 'using' then return jsonb_build_object('ok',false,'error','STUDY_STAGE_CLOSED'); end if;
  if p.book_id is distinct from p_book then return jsonb_build_object('ok',false,'error','NOT_STUDY_BOOK'); end if;
  select * into s from spl_study_private.settings where id;
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
    select count(*) into n from public.spl_ai_usage where user_id = uid and action = 'audio_preview';
    if n >= s.max_previews then return jsonb_build_object('ok',false,'error','STUDY_LIMIT_PREVIEW'); end if;
  else
    return jsonb_build_object('ok',false,'error','ACTION_NOT_ALLOWED');
  end if;
  return jsonb_build_object('ok',true,'role','participant');
end; $$;

revoke all on function public.spl_study_ai_allowance(uuid,text,text,text) from public, anon;
grant execute on function public.spl_study_ai_allowance(uuid,text,text,text) to authenticated;
revoke all on function public.spl_study_link_book(uuid) from public, anon;
grant execute on function public.spl_study_link_book(uuid) to authenticated;
