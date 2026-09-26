-- PROPOSAL ONLY: not applied. Dedicated listening positions; no changes to existing tables.
begin;
create table public.spl_listening_positions (
 user_id uuid not null references auth.users(id) on delete cascade,
 audio_key text not null,
 part integer not null check(part >= 0),
 seconds double precision not null check(seconds >= 0 and seconds < 86400),
 updated_at timestamptz not null,
 primary key(user_id,audio_key),
 check(split_part(audio_key,'/',1)=user_id::text)
);
alter table public.spl_listening_positions enable row level security;
create policy listening_owner on public.spl_listening_positions for all to authenticated
 using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
revoke all on public.spl_listening_positions from anon;
grant select,insert,update,delete on public.spl_listening_positions to authenticated;
create function public.spl_sync_listening_position(p_audio_key text,p_part integer,p_seconds double precision,p_updated_at timestamptz)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or split_part(p_audio_key,'/',1)<>auth.uid()::text then raise exception 'OWNER_MISMATCH'; end if;
 if p_updated_at > now()+interval '5 minutes' then raise exception 'DEVICE_CLOCK_AHEAD'; end if;
 insert into public.spl_listening_positions(user_id,audio_key,part,seconds,updated_at)
 values(auth.uid(),p_audio_key,p_part,p_seconds,p_updated_at)
 on conflict(user_id,audio_key) do update set part=excluded.part,seconds=excluded.seconds,updated_at=excluded.updated_at
 where excluded.updated_at > public.spl_listening_positions.updated_at;
end;$$;
revoke all on function public.spl_sync_listening_position(text,integer,double precision,timestamptz) from public,anon;
grant execute on function public.spl_sync_listening_position(text,integer,double precision,timestamptz) to authenticated;
commit;
