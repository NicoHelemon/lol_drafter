-- Automatic choices and a host-only atomic draft reset. Statistics are untouched.
begin;
create function public.validate_guided_choices(s jsonb,idx integer,hist jsonb) returns void language plpgsql set search_path=public as $$
declare stages jsonb=public.draft_stages(s->>'draftMode');st jsonb;active_team text;base jsonb;currentcp jsonb=public.draft_checkpoint(s);team text;extra integer;i integer;
begin
 st=stages->idx;
 active_team=case when s->>'side'=st->>'side' then 'ally' else 'enemy' end;
 base=coalesce(hist->(idx-1),'{"picks":{"ally":[],"enemy":[]},"bans":{"ally":[null,null,null,null,null],"enemy":[null,null,null,null,null]}}');
 foreach team in array array['ally','enemy'] loop
  if exists(select 1 from jsonb_array_elements_text(base->'picks'->team) p where not (currentcp->'picks'->team ? p)) then raise exception 'Confirmed picks are locked';end if;
  extra=case when st->>'kind'='pick' and team=active_team then (st->>'count')::integer else 0 end;
  if jsonb_array_length(s->'picks'->team)>jsonb_array_length(base->'picks'->team)+extra then raise exception 'Follow the current pick order';end if;
  for i in 0..4 loop
   if not(coalesce(st->>'kind'='bans',false) or coalesce(st->>'kind'='ban' and team=active_team and (st->>'slot')::integer=i,false)) and s->'bans'->team->i is distinct from base->'bans'->team->i then raise exception 'Follow the current ban order';end if;
  end loop;
 end loop;
end $$;
create or replace function public.guard_guided_draft() returns trigger language plpgsql security definer set search_path=public as $$
declare s jsonb;prev jsonb;stages jsonb;st jsonb;idx integer;oldidx integer;hist jsonb;oldhist jsonb;base jsonb;currentcp jsonb;team text;active_team text;extra integer;i integer;oldst jsonb;
begin
 s=new.state;
 if coalesce(s->>'draftMode','') not in ('ranked','tournament') then raise exception 'Choose ranked or tournament draft';end if;
 stages=public.draft_stages(s->>'draftMode');
 if s?'draftStep' and (jsonb_typeof(s->'draftStep')<>'number' or (s->>'draftStep')::numeric<>trunc((s->>'draftStep')::numeric)) then raise exception 'Invalid draft step';end if;
 idx=coalesce((s->>'draftStep')::integer,0);hist=coalesce(s->'draftHistory','[]'::jsonb);
 if jsonb_typeof(hist)<>'array' then raise exception 'Invalid draft history';end if;
 if idx<0 or idx>jsonb_array_length(stages) or jsonb_array_length(hist)<>idx then raise exception 'Invalid draft progression';end if;
 if s->>'phase'='setup' then
  if idx<>0 or hist<>'[]' or s->'picks'->'ally'<>'[]' or s->'picks'->'enemy'<>'[]' or s->'bans'<>jsonb_build_object('ally','[null,null,null,null,null]'::jsonb,'enemy','[null,null,null,null,null]'::jsonb) then raise exception 'Picks and bans start in the draft';end if;
  if s->>'draftMode'='ranked' and exists(select 1 from jsonb_each(coalesce(s->'rolePools'->'enemy','{}')) p where p.value<>'[]'::jsonb) then raise exception 'Enemy candidates are unavailable in the ranked lobby';end if;
 end if;
 if tg_op='INSERT' then
  if s->>'phase'<>'setup' then raise exception 'Create a lobby first';end if;
  return new;
 end if;
 prev=old.state;
 if s->'draftMode' is distinct from prev->'draftMode' then raise exception 'Draft mode is fixed when creating the room';end if;
 if prev->>'phase'='setup' then
  if s->>'phase'='live' and (idx<>0 or hist<>'[]' or public.draft_checkpoint(s) is distinct from public.draft_checkpoint(prev)) then raise exception 'Start at the first draft step';end if;
  return new;
 end if;
 if s->'side' is distinct from prev->'side' then raise exception 'Side is locked during the draft';end if;
 oldidx=coalesce((prev->>'draftStep')::integer,0);oldhist=coalesce(prev->'draftHistory','[]');currentcp=public.draft_checkpoint(s);
 if idx=oldidx then
  if hist is distinct from oldhist then raise exception 'Confirmed draft history is locked';end if;
 elsif idx=oldidx+1 then
  -- Validate the choice against the OLD turn before it becomes a locked checkpoint.
  -- Otherwise a forged next-step payload could silently add picks from later turns.
  perform public.validate_guided_choices(s,oldidx,oldhist);
  oldst=stages->oldidx;
  if oldst is null then raise exception 'Draft is already complete';end if;
  if auth.uid() is distinct from old.host_id and currentcp=public.draft_checkpoint(prev) then raise exception 'Only the host can skip a ban';end if;
  active_team=case when prev->>'side'=oldst->>'side' then 'ally' else 'enemy' end;
  base=coalesce(oldhist->(oldidx-1),'{"picks":{"ally":[],"enemy":[]},"bans":{"ally":[null,null,null,null,null],"enemy":[null,null,null,null,null]}}');
  if oldst->>'kind'='pick' and jsonb_array_length(s->'picks'->active_team)<>jsonb_array_length(base->'picks'->active_team)+(oldst->>'count')::integer then raise exception 'Complete the current draft step first';end if;
  if hist is distinct from oldhist||jsonb_build_array(currentcp) then raise exception 'Invalid draft completion';end if;
 elsif idx=oldidx-1 and oldidx>0 then
  if auth.uid() is distinct from old.host_id or hist is distinct from (oldhist-(oldidx-1)) or currentcp is distinct from oldhist->(oldidx-1) then raise exception 'Invalid previous draft step';end if;
 else raise exception 'Advance one draft step at a time';end if;
 perform public.validate_guided_choices(s,idx,hist);
 return new;
end $$;
-- Rewind through the existing guarded transitions inside ONE locked transaction.
-- No client-supplied reset flag or bypass of the consent/order guards is accepted.
create function public.clear_draft(room_id uuid,expected_version integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.rooms;s jsonb;hist jsonb;cp jsonb;idx integer;team text;items jsonb;
begin
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied';end if;
 if r.host_id is distinct from auth.uid() then raise exception 'Only the host can clear the draft';end if;
 if r.version is distinct from expected_version then raise exception 'Conflict: room updated. Please try again.';end if;
 if r.state->>'phase'<>'live' then raise exception 'Start the draft first';end if;
 delete from public.pick_swap_requests where pick_swap_requests.room_id=r.id;
 delete from public.role_swap_requests where role_swap_requests.room_id=r.id;
 s=r.state;idx=coalesce((s->>'draftStep')::integer,0);
 while idx>0 loop
  hist=s->'draftHistory';cp=hist->(idx-1);
  foreach team in array array['ally','enemy'] loop
   select coalesce(jsonb_agg(p order by pos),'[]'::jsonb) into items from jsonb_array_elements(s->'picks'->team) with ordinality x(p,pos) where cp->'picks'->team ? (p->>'championId');
   s=jsonb_set(s,array['picks',team],items);
  end loop;
  idx=idx-1;s=jsonb_set(s,'{draftStep}',to_jsonb(idx));s=jsonb_set(s,'{draftHistory}',hist-idx);s=jsonb_set(s,'{bans}',cp->'bans');
  update public.rooms set state=s where id=r.id;
 end loop;
 s=jsonb_set(s,'{picks}','{"ally":[],"enemy":[]}'::jsonb);
 s=jsonb_set(s,'{bans}','{"ally":[null,null,null,null,null],"enemy":[null,null,null,null,null]}'::jsonb);
 select jsonb_agg(item order by pos) into items from jsonb_array_elements(jsonb_build_array('Draft cleared')||(s->'history')) with ordinality x(item,pos) where pos<=25;
 s=jsonb_set(s,'{history}',items);
 perform public.validate_draft(s);
 update public.rooms set state=s,version=version+1 where id=r.id returning * into r;
 return to_jsonb(r);
end $$;
revoke all on function public.validate_guided_choices(jsonb,integer,jsonb),public.clear_draft(uuid,integer) from public,anon,authenticated;
grant execute on function public.clear_draft(uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
