-- DRAFT ONLY — do not apply before security review and owner approval.
-- Email-bound, revocable reviewer access for selected Smart Personal Library books.

begin;

create extension if not exists citext;

create table if not exists public.spl_review_invites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  reviewer_email citext not null,
  reviewer_user_id uuid references auth.users(id) on delete set null,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create table if not exists public.spl_book_shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  reviewer_user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.spl_books(id) on delete cascade,
  invite_id uuid references public.spl_review_invites(id) on delete set null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (reviewer_user_id, book_id)
);

create table if not exists public.spl_reviewer_feedback (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  reviewer_user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.spl_books(id) on delete cascade,
  rating smallint check (rating between 1 and 5),
  observation text,
  suggestion text,
  research_consent boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.spl_review_invites enable row level security;
alter table public.spl_book_shares enable row level security;
alter table public.spl_reviewer_feedback enable row level security;

create policy spl_review_invites_owner_all on public.spl_review_invites for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy spl_review_invites_reviewer_select on public.spl_review_invites for select to authenticated
  using (reviewer_user_id = auth.uid() and status = 'accepted' and expires_at > now());

create policy spl_book_shares_owner_all on public.spl_book_shares for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy spl_book_shares_reviewer_select on public.spl_book_shares for select to authenticated
  using (reviewer_user_id = auth.uid() and revoked_at is null and expires_at > now());

create policy spl_reviewer_feedback_owner_select on public.spl_reviewer_feedback for select to authenticated
  using (owner_id = auth.uid());
create policy spl_reviewer_feedback_reviewer_insert on public.spl_reviewer_feedback for insert to authenticated
  with check (reviewer_user_id = auth.uid() and exists (
    select 1 from public.spl_book_shares s where s.book_id = spl_reviewer_feedback.book_id
      and s.reviewer_user_id = auth.uid() and s.revoked_at is null and s.expires_at > now()
  ));
create policy spl_reviewer_feedback_reviewer_select on public.spl_reviewer_feedback for select to authenticated
  using (reviewer_user_id = auth.uid());

create policy spl_books_reviewer_select on public.spl_books for select to authenticated using (
  exists (select 1 from public.spl_book_shares s where s.book_id = spl_books.id
    and s.reviewer_user_id = auth.uid() and s.revoked_at is null and s.expires_at > now())
);
create policy spl_analyses_reviewer_select on public.spl_analyses for select to authenticated using (
  exists (select 1 from public.spl_book_shares s where s.book_id = spl_analyses.book_id
    and s.reviewer_user_id = auth.uid() and s.revoked_at is null and s.expires_at > now())
);
create policy spl_questions_reviewer_select on public.spl_questions for select to authenticated using (
  exists (select 1 from public.spl_book_shares s where s.book_id = spl_questions.book_id
    and s.reviewer_user_id = auth.uid() and s.revoked_at is null and s.expires_at > now())
);
create policy spl_audio_outputs_reviewer_select on public.spl_audio_outputs for select to authenticated using (
  exists (select 1 from public.spl_book_shares s where s.book_id = spl_audio_outputs.book_id
    and s.reviewer_user_id = auth.uid() and s.revoked_at is null and s.expires_at > now())
);

create policy spl_storage_reviewer_select on storage.objects for select to authenticated using (
  bucket_id in ('spl-books','spl-audio') and exists (
    select 1 from public.spl_book_shares s
    where s.reviewer_user_id = auth.uid() and s.revoked_at is null and s.expires_at > now()
      and name like s.owner_id::text || '/' || s.book_id::text || '/%'
  )
);

commit;
