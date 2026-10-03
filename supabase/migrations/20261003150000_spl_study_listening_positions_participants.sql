-- Additive: enrolled study participants (anonymous sessions) may keep their own listening position.
-- The existing owner policy (listening_owner) is unchanged. Applied manually 2026-10-03.
drop policy if exists listening_study_participant on public.spl_listening_positions;
create policy listening_study_participant on public.spl_listening_positions
  for all to authenticated
  using ((select auth.uid()) = user_id and public.spl_study_my_participant() is not null)
  with check ((select auth.uid()) = user_id and public.spl_study_my_participant() is not null);
