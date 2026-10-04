-- Formative evaluation (design iteration) feedback from the shared user view.
-- NOT study data: used to improve the platform before the study version is frozen.
-- Inserted only by the spl-design-feedback edge function (service role) after validating the shared-view session.
create table if not exists public.spl_design_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null default 'shared' check (source in ('shared','owner_test')),
  book_id uuid references public.spl_books(id) on delete set null,
  session_hash text check (session_hash is null or session_hash ~ '^[a-f0-9]{64}$'),
  consent boolean not null check (consent),
  answers jsonb not null,
  device text check (device is null or char_length(device) <= 40),
  form_version text not null default '1.0'
);
create index if not exists spl_design_feedback_created_idx on public.spl_design_feedback (created_at desc);
alter table public.spl_design_feedback enable row level security;
drop policy if exists spl_design_feedback_researcher_read on public.spl_design_feedback;
create policy spl_design_feedback_researcher_read on public.spl_design_feedback
  for select to authenticated using (public.spl_study_is_researcher());
drop policy if exists spl_design_feedback_researcher_delete on public.spl_design_feedback;
create policy spl_design_feedback_researcher_delete on public.spl_design_feedback
  for delete to authenticated using (public.spl_study_is_researcher());
revoke all on public.spl_design_feedback from anon;
grant select, delete on public.spl_design_feedback to authenticated;
