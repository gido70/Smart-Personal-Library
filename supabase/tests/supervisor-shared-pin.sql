-- Run as database owner after configuring PIN. All fixture mutations roll back.
begin;
do $$
declare r jsonb;
begin
 if has_function_privilege('anon','public.spl_supervisor_access(text,text,text)','execute') or has_function_privilege('authenticated','public.spl_supervisor_access(text,text,text)','execute') then raise exception 'public function exposure'; end if;
 if has_schema_privilege('anon','spl_supervisor_private','usage') then raise exception 'private schema exposure'; end if;
 r:=public.spl_supervisor_access('session',repeat('a',64));
 if (r->>'ok')::boolean then raise exception 'unknown session accepted'; end if;
 update spl_supervisor_private.settings set attempts=9,window_start=now();
 r:=public.spl_supervisor_access('login',repeat('b',64),repeat('a',64));
 if (r->>'status')::int<>403 then raise exception 'wrong PIN accepted'; end if;
 r:=public.spl_supervisor_access('login',(select pin_hash from spl_supervisor_private.settings),repeat('a',64));
 if (r->>'status')::int<>429 then raise exception 'rate limit failed'; end if;
 update spl_supervisor_private.settings set window_start=now()-interval '16 minutes';
 r:=public.spl_supervisor_access('login',(select pin_hash from spl_supervisor_private.settings),repeat('a',64));
 if not (r->>'ok')::boolean then raise exception 'window reset failed'; end if;
 r:=public.spl_supervisor_access('session',repeat('a',64));
 if not (r->>'ok')::boolean then raise exception 'session failed'; end if;
 update spl_supervisor_private.settings set version=version+1;
 r:=public.spl_supervisor_access('session',repeat('a',64));
 if (r->>'ok')::boolean then raise exception 'revocation failed'; end if;
 update spl_supervisor_private.settings set version=version-1;
 update spl_supervisor_private.sessions set expires_at=now()-interval '1 second' where token_hash=repeat('a',64);
 r:=public.spl_supervisor_access('session',repeat('a',64));
 if (r->>'ok')::boolean then raise exception 'expired session accepted'; end if;
end $$;
rollback;