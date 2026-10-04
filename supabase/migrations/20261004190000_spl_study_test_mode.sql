-- Test participants (is_test, codes T-…) can take the post questionnaire right after the pre, and the follow-up
-- right after the post, to test the questionnaires. Real participants are unchanged (7 days from approval, then 14).
create or replace function public.spl_study_submit(p_key text, p_answers jsonb, p_started_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.spl_study_participants%rowtype; ver text; attn boolean;
begin
  select * into p from public.spl_study_participants where id = public.spl_study_my_participant() for update;
  if not found then return jsonb_build_object('ok',false,'error','NOT_JOINED'); end if;
  if jsonb_typeof(p_answers) <> 'object' then return jsonb_build_object('ok',false,'error','BAD_ANSWERS'); end if;
  if p_key not in ('pre','post','followup') then return jsonb_build_object('ok',false,'error','BAD_KEY'); end if;
  if p_key = 'pre' and p.status <> 'consented' then return jsonb_build_object('ok',false,'error','WRONG_STAGE'); end if;
  if p_key = 'post' then
    if p.is_test then
      if p.status not in ('pre_done','using') then return jsonb_build_object('ok',false,'error','WRONG_STAGE'); end if;
    elsif p.status <> 'using' or p.post_due_at is null or now() < p.post_due_at then
      return jsonb_build_object('ok',false,'error','NOT_YET');
    end if;
  end if;
  if p_key = 'followup' then
    if p.status <> 'post_done' then return jsonb_build_object('ok',false,'error','WRONG_STAGE'); end if;
    if not p.is_test and (p.followup_due_at is null or now() < p.followup_due_at) then return jsonb_build_object('ok',false,'error','NOT_YET'); end if;
  end if;
  select version into ver from public.spl_study_instruments where key = p_key and active;
  if ver is null then return jsonb_build_object('ok',false,'error','NO_ACTIVE_INSTRUMENT'); end if;
  attn := case p_key when 'pre' then (p_answers->>'ATTN1') = '2' when 'post' then (p_answers->>'ATTN2') = '2' else null end;
  insert into public.spl_study_responses(participant_id, instrument_key, instrument_version, answers, attention_passed, started_at)
  values (p.id, p_key, ver, p_answers, attn, p_started_at)
  on conflict (participant_id, instrument_key) do nothing;
  if not found then return jsonb_build_object('ok',false,'error','ALREADY_SUBMITTED'); end if;
  update public.spl_study_participants set
    status = case p_key when 'pre' then 'pre_done' when 'post' then 'post_done' else 'followup_done' end,
    followup_due_at = case when p_key = 'post' then (case when p.is_test then now() else now() + interval '14 days' end) else followup_due_at end
  where id = p.id;
  return jsonb_build_object('ok',true);
end; $$;
