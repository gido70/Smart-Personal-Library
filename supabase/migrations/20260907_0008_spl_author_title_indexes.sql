-- Persistent authority records for personal-library authors.
-- Authors deliberately survive book deletion; book links are removed by FK cascade.
create table if not exists public.spl_authors (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  authorized_name text not null, normalized_name text not null, biography text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (owner_id, normalized_name)
);
create table if not exists public.spl_book_authors (
  book_id uuid not null references public.spl_books(id) on delete cascade,
  author_id uuid not null references public.spl_authors(id) on delete cascade,
  role text not null default 'author', position smallint not null default 1,
  primary key (book_id, author_id, role)
);
create index if not exists spl_authors_owner_name_idx on public.spl_authors(owner_id, authorized_name);
create index if not exists spl_book_authors_author_idx on public.spl_book_authors(author_id, position);
alter table public.spl_authors enable row level security;
alter table public.spl_book_authors enable row level security;
drop policy if exists spl_authors_owner_all on public.spl_authors;
create policy spl_authors_owner_all on public.spl_authors for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists spl_book_authors_owner_all on public.spl_book_authors;
create policy spl_book_authors_owner_all on public.spl_book_authors for all to authenticated
  using (exists (select 1 from public.spl_books b where b.id = spl_book_authors.book_id and b.user_id = auth.uid()))
  with check (
    exists (select 1 from public.spl_books b where b.id = spl_book_authors.book_id and b.user_id = auth.uid()) and
    exists (select 1 from public.spl_authors a where a.id = spl_book_authors.author_id and a.owner_id = auth.uid())
  );
insert into public.spl_authors(owner_id, authorized_name, normalized_name)
select distinct b.user_id, trim(b.metadata->>'author'), lower(regexp_replace(trim(b.metadata->>'author'), '\s+', ' ', 'g'))
from public.spl_books b where nullif(trim(b.metadata->>'author'), '') is not null
on conflict (owner_id, normalized_name) do update set authorized_name = excluded.authorized_name, updated_at = now();
insert into public.spl_book_authors(book_id, author_id, role, position)
select b.id, a.id, 'author', 1 from public.spl_books b join public.spl_authors a
  on a.owner_id = b.user_id and a.normalized_name = lower(regexp_replace(trim(b.metadata->>'author'), '\s+', ' ', 'g'))
where nullif(trim(b.metadata->>'author'), '') is not null on conflict do nothing;

-- Older analysed books may hold the extracted author only inside overview results.
insert into public.spl_authors(owner_id, authorized_name, normalized_name)
select distinct b.user_id, trim(x.content->'metadata'->>'author'),
  lower(regexp_replace(trim(x.content->'metadata'->>'author'), '\s+', ' ', 'g'))
from public.spl_analyses x join public.spl_books b on b.id = x.book_id
where x.kind = 'overview' and nullif(trim(x.content->'metadata'->>'author'), '') is not null
on conflict (owner_id, normalized_name) do update set authorized_name = excluded.authorized_name, updated_at = now();

insert into public.spl_book_authors(book_id, author_id, role, position)
select b.id, a.id, 'author', 1
from public.spl_analyses x join public.spl_books b on b.id = x.book_id
join public.spl_authors a on a.owner_id = b.user_id
 and a.normalized_name = lower(regexp_replace(trim(x.content->'metadata'->>'author'), '\s+', ' ', 'g'))
where x.kind = 'overview' and nullif(trim(x.content->'metadata'->>'author'), '') is not null
on conflict do nothing;
