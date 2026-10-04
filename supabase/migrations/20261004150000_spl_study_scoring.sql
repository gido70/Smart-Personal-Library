-- Scoring of open comprehension answers (rubric 0–2, error codes E/P) with read-only access to the
-- participant's book and platform summary, for researchers/raters only. Additive.
create table if not exists public.spl_study_scores (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.spl_study_participants(id) on delete cascade,
  instrument_key text not null check (instrument_key in ('post','followup')),
  item_code text not null check (item_code ~ '^[A-Z0-9_]{2,40}$'),
  score smallint check (score between 0 and 2),
  error_code text check (error_code in ('E','P')),
  note text check (note is null or char_length(note) <= 2000),
  rater_id uuid not null default auth.uid(),
  rater_label text not null default 'first' check (rater_label in ('first','second')),
  updated_at timestamptz not null default now(),
  unique (participant_id, instrument_key, item_code, rater_id)
);
alter table public.spl_study_scores enable row level security;
drop policy if exists spl_study_scores_researcher_all on public.spl_study_scores;
create policy spl_study_scores_researcher_all on public.spl_study_scores
  for all to authenticated using (public.spl_study_is_researcher()) with check (public.spl_study_is_researcher() and rater_id = auth.uid());
revoke all on public.spl_study_scores from anon;
grant select, insert, update, delete on public.spl_study_scores to authenticated;

-- Material for scoring one participant: book card and the platform's saved overview (read-only).
create or replace function public.spl_study_scoring_material(p_participant uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p public.spl_study_participants%rowtype; b public.spl_books%rowtype; a jsonb;
begin
  if not public.spl_study_is_researcher() then return jsonb_build_object('ok',false,'error','NOT_RESEARCHER'); end if;
  select * into p from public.spl_study_participants where id = p_participant;
  if not found or p.book_id is null then return jsonb_build_object('ok',false,'error','NO_BOOK'); end if;
  select * into b from public.spl_books where id = p.book_id;
  if not found then return jsonb_build_object('ok',false,'error','NO_BOOK'); end if;
  select content into a from public.spl_analyses where book_id = b.id and kind = 'overview' order by created_at desc limit 1;
  return jsonb_build_object('ok',true,'title',b.title,'storage_path',b.storage_path,'pages',p.book_pages,'analysis',a);
end; $$;
revoke all on function public.spl_study_scoring_material(uuid) from public, anon;
grant execute on function public.spl_study_scoring_material(uuid) to authenticated;

-- Read-only access for researchers to study participants' book files (needed to check answers against the book).
drop policy if exists spl_books_study_researcher_read on storage.objects;
create policy spl_books_study_researcher_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'spl-books'
    and public.spl_study_is_researcher()
    and exists (select 1 from public.spl_study_participants sp where sp.user_id::text = (storage.foldername(name))[1])
  );
