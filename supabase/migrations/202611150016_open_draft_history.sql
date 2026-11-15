-- Shared bounded choice history, drag-only swaps and irreversible Open draft.
-- No statistical tables, collector configuration or model is changed.
begin;
alter table public.rooms add column undo_count integer not null default 0 check(undo_count between 0 and 60),add column redo_count integer not null default 0 check(redo_count between 0 and 60);
create table public.draft_timelines(room_id uuid primary key references public.rooms(id) on delete cascade,undo jsonb not null default '[]',redo jsonb not null default '[]',restoring boolean not null default false);
alter table public.draft_timelines enable row level security;
revoke all on public.draft_timelines from public,anon,authenticated;
create function public.draft_position(s jsonb) returns jsonb language sql immutable set search_path=public as $$
 select jsonb_build_object('picks',s->'picks','bans',s->'bans','draftStep',coalesce(s->'draftStep','0'),'draftHistory',coalesce(s->'draftHistory','[]'))
$$;
create function public.draft_stack_push(stack jsonb,item jsonb) returns jsonb language sql immutable set search_path=public as $$
 select coalesce(jsonb_agg(value order by pos),'[]'::jsonb) from jsonb_array_elements(stack||jsonb_build_array(item)) with ordinality x(value,pos) where pos>greatest(0,jsonb_array_length(stack)+1-60)
$$;
create function public.draft_assignments(s jsonb) returns jsonb language sql immutable set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_array(p->>'id',p->>'role') order by p->>'id'),'[]'::jsonb) from jsonb_array_elements(s->'players') p
$$;
create or replace function public.guard_guided_draft() returns trigger language plpgsql security definer set search_path=public as $$
declare s jsonb;prev jsonb;stages jsonb;st jsonb;idx integer;oldidx integer;hist jsonb;oldhist jsonb;base jsonb;currentcp jsonb;team text;active_team text;extra integer;i integer;oldst jsonb;
begin
 s=new.state;
 if coalesce(s->>'draftMode','') not in ('ranked','tournament') then raise exception 'Choose ranked or tournament draft';end if;
 if s?'openDraft' and jsonb_typeof(s->'openDraft')<>'boolean' then raise exception 'Invalid open draft mode';end if;
 stages=public.draft_stages(s->>'draftMode');
 if s?'draftStep' and (jsonb_typeof(s->'draftStep')<>'number' or (s->>'draftStep')::numeric<>trunc((s->>'draftStep')::numeric)) then raise exception 'Invalid draft step';end if;
 idx=coalesce((s->>'draftStep')::integer,0);hist=coalesce(s->'draftHistory','[]'::jsonb);
 if jsonb_typeof(hist)<>'array' then raise exception 'Invalid draft history';end if;
 if idx<0 or idx>jsonb_array_length(stages) or jsonb_array_length(hist)<>idx then raise exception 'Invalid draft progression';end if;
 if coalesce((s->>'openDraft')::boolean,false) and (s->>'phase'<>'live' or idx<>0 or hist<>'[]') then raise exception 'Invalid open draft progression';end if;
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
 if coalesce((prev->>'openDraft')::boolean,false) and not coalesce((s->>'openDraft')::boolean,false) then raise exception 'Open draft is permanent';end if;
 if coalesce((s->>'openDraft')::boolean,false) then
  if not coalesce((prev->>'openDraft')::boolean,false) and (auth.uid() is distinct from old.host_id or public.draft_checkpoint(s) is distinct from public.draft_checkpoint(prev)) then raise exception 'Only the host can open the draft without changing picks';end if;
  return new;
 end if;
 -- Only the host RPC can set this private, transaction-scoped restoration ticket.
 if exists(select 1 from public.draft_timelines h where h.room_id=new.id and h.restoring) then return new;end if;
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

create function public.track_draft_choices() returns trigger language plpgsql security definer set search_path=public as $$
declare h public.draft_timelines;team text;reset_history boolean;
begin
 insert into public.draft_timelines(room_id) values(new.id) on conflict do nothing;
 select * into h from public.draft_timelines where room_id=new.id for update;
 if not h.restoring then
  reset_history=old.state->>'phase'<>'live' or coalesce(old.state->'openDraft','false') is distinct from coalesce(new.state->'openDraft','false') or public.draft_assignments(old.state) is distinct from public.draft_assignments(new.state);
  foreach team in array array['ally','enemy'] loop
   if exists(select 1 from jsonb_array_elements(old.state->'picks'->team) a join jsonb_array_elements(new.state->'picks'->team) b on a->>'championId'=b->>'championId' where a->'role' is distinct from b->'role') then reset_history=true;end if;
  end loop;
  if reset_history then h.undo='[]';h.redo='[]';
  elsif public.draft_position(old.state) is distinct from public.draft_position(new.state) then h.undo=public.draft_stack_push(h.undo,public.draft_position(old.state));h.redo='[]';end if;
  update public.draft_timelines set undo=h.undo,redo=h.redo where room_id=new.id;
 end if;
 new.undo_count=jsonb_array_length(h.undo);new.redo_count=jsonb_array_length(h.redo);return new;
end $$;
create trigger zzz_track_draft_choices before update of state on public.rooms for each row execute function public.track_draft_choices();

create function public.control_draft(room_id uuid,expected_version integer,action text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.rooms;h public.draft_timelines;s jsonb;pos jsonb;log jsonb;
begin
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied';end if;
 if r.host_id is distinct from auth.uid() then raise exception 'Only the host can control draft history';end if;
 if r.version is distinct from expected_version then raise exception 'Conflict: room updated. Please try again.';end if;
 if r.state->>'phase'<>'live' then raise exception 'Start the draft first';end if;
 if action is null or action not in ('undo','redo','open','clear') then raise exception 'Invalid draft control';end if;
 select * into h from public.draft_timelines where draft_timelines.room_id=r.id for update;s=r.state;
 if action='open' then
  if coalesce((s->>'openDraft')::boolean,false) then raise exception 'Draft is already open';end if;
  s=s||'{"openDraft":true,"draftStep":0,"draftHistory":[]}'::jsonb;h.undo='[]';h.redo='[]';
 elsif action='clear' then
  pos=public.draft_position(s);s=s||'{"picks":{"ally":[],"enemy":[]},"bans":{"ally":[null,null,null,null,null],"enemy":[null,null,null,null,null]},"draftStep":0,"draftHistory":[]}'::jsonb;
  if public.draft_position(s) is distinct from pos then h.undo=public.draft_stack_push(h.undo,pos);h.redo='[]';end if;
 elsif action='undo' then
  if jsonb_array_length(h.undo)=0 then raise exception 'Nothing to undo';end if;
  pos=h.undo->-1;h.undo=h.undo-(jsonb_array_length(h.undo)-1);h.redo=public.draft_stack_push(h.redo,public.draft_position(s));s=s||pos;
 else
  if jsonb_array_length(h.redo)=0 then raise exception 'Nothing to redo';end if;
  pos=h.redo->-1;h.redo=h.redo-(jsonb_array_length(h.redo)-1);h.undo=public.draft_stack_push(h.undo,public.draft_position(s));s=s||pos;
 end if;
 select jsonb_agg(item order by ord) into log from jsonb_array_elements(jsonb_build_array(case action when 'open' then 'Open draft enabled' when 'clear' then 'Draft cleared' when 'undo' then 'Undo' else 'Redo' end)||(s->'history')) with ordinality x(item,ord) where ord<=25;
 s=jsonb_set(s,'{history}',log);perform public.validate_draft(s);
 delete from public.role_swap_requests where role_swap_requests.room_id=r.id;delete from public.pick_swap_requests where pick_swap_requests.room_id=r.id;
 update public.draft_timelines set undo=h.undo,redo=h.redo,restoring=true where draft_timelines.room_id=r.id;
 update public.rooms set state=s,version=version+1 where id=r.id returning * into r;
 update public.draft_timelines set restoring=false where draft_timelines.room_id=r.id;
 return to_jsonb(r);
end $$;
create or replace function public.clear_draft(room_id uuid,expected_version integer) returns jsonb language sql security definer set search_path=public as $$select public.control_draft(room_id,expected_version,'clear')$$;
revoke all on function public.draft_position(jsonb),public.draft_stack_push(jsonb,jsonb),public.draft_assignments(jsonb),public.track_draft_choices(),public.control_draft(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.control_draft(uuid,integer,text) to authenticated;
notify pgrst,'reload schema';
commit;
