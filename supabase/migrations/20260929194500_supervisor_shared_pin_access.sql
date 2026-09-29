create schema if not exists spl_supervisor_private;
revoke all on schema spl_supervisor_private from public, anon, authenticated;
create table spl_supervisor_private.settings (
 id boolean primary key default true check(id),
 pin_hash text not null check(pin_hash ~ '^[a-f0-9]{64}$'),
 version integer not null default 1,
 window_start timestamptz not null default now(),
 attempts integer not null default 0
);
create table spl_supervisor_private.sessions (
 token_hash text primary key,
 version integer not null,
 expires_at timestamptz not null
);
alter table spl_supervisor_private.settings enable row level security;
alter table spl_supervisor_private.sessions enable row level security;
revoke all on all tables in schema spl_supervisor_private from public, anon, authenticated;
create or replace function public.spl_supervisor_access(p_action text, p_hash text, p_new_hash text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cfg spl_supervisor_private.settings%rowtype;
begin
 if p_action = 'login' then
  select * into cfg from spl_supervisor_private.settings where id = true for update;
  if not found then return jsonb_build_object('ok',false,'status',503); end if;
  if cfg.window_start < now() - interval '15 minutes' then
   update spl_supervisor_private.settings set window_start=now(),attempts=0 where id=true;
   cfg.attempts := 0;
  end if;
  if cfg.attempts >= 10 then return jsonb_build_object('ok',false,'status',429); end if;
  update spl_supervisor_private.settings set attempts=attempts+1 where id=true;
  if p_hash is distinct from cfg.pin_hash or p_new_hash is null or p_new_hash !~ '^[a-f0-9]{64}$' then
   return jsonb_build_object('ok',false,'status',403);
  end if;
  delete from spl_supervisor_private.sessions where expires_at <= now() or version <> cfg.version;
  insert into spl_supervisor_private.sessions(token_hash,version,expires_at) values(p_new_hash,cfg.version,now()+interval '30 days');
  return jsonb_build_object('ok',true,'status',200);
 end if;
 if p_action = 'session' then
  return jsonb_build_object('ok',exists(select 1 from spl_supervisor_private.sessions s
   join spl_supervisor_private.settings c on c.id=true and c.version=s.version
   where s.token_hash=p_hash and s.expires_at>now()),'status',403);
 end if;
 return jsonb_build_object('ok',false,'status',403);
end;
$$;
revoke all on function public.spl_supervisor_access(text,text,text) from public,anon,authenticated;
grant execute on function public.spl_supervisor_access(text,text,text) to service_role;
