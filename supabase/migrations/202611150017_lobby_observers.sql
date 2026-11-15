-- Guided restart, shared return to lobby and five player + three observer seats.
-- Statistical tables and calculation are unchanged.
begin;
create or replace function public.validate_draft(s jsonb) returns void language plpgsql set search_path=public as $$
declare t text;p jsonb;c text;seen text[]='{}';roles text[];seats text[]='{}';ids text[]='{}';ds jsonb;team_bans text[];
begin
 if coalesce(s->>'phase','') not in ('setup','live') or coalesce(s->>'side','') not in ('blue','red') then raise exception 'Invalid room state';end if;
 if jsonb_typeof(s->'players') is distinct from 'array' or jsonb_array_length(s->'players') not between 1 and 8 then raise exception 'Up to eight participants allowed';end if;
 if (select count(*) from jsonb_array_elements(s->'players') member_row where not coalesce((member_row->>'observer')::boolean,false))>5 or (select count(*) from jsonb_array_elements(s->'players') member_row where coalesce((member_row->>'observer')::boolean,false))>3 then raise exception 'Five player seats and three observer seats available';end if;
 for p in select value from jsonb_array_elements(s->'players') loop
  if p?'observer' and jsonb_typeof(p->'observer')<>'boolean' or coalesce((p->>'observer')::boolean,false) and (p->>'role' is not null or p->'pool'<>'[]') then raise exception 'Observers cannot occupy roles or have candidate pools';end if;
  if coalesce(p->>'id','')='' or p->>'id'=any(ids) or coalesce(trim(p->>'name'),'')='' or length(p->>'name')>32 then raise exception 'Invalid player';end if;ids=array_append(ids,p->>'id');
  if p->>'role' is not null then
   if p->>'role' not in ('Top','Jungle','Mid','ADC','Support') or p->>'role'=any(seats) then raise exception 'Role already taken or invalid';end if;seats=array_append(seats,p->>'role');
  end if;
  if jsonb_typeof(p->'pool') is distinct from 'array' or exists(select 1 from jsonb_array_elements(p->'pool') x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^[0-9]{1,5}$') or (select count(*)<>count(distinct value) from jsonb_array_elements(p->'pool')) then raise exception 'Invalid pool';end if;
 end loop;
 foreach t in array array['ally','enemy'] loop
  if jsonb_typeof(s->'picks'->t) is distinct from 'array' or jsonb_array_length(s->'picks'->t)>5 or jsonb_typeof(s->'bans'->t) is distinct from 'array' or jsonb_array_length(s->'bans'->t)<>5 then raise exception 'Up to five picks and bans per team';end if;
  roles='{}';
  for p in select value from jsonb_array_elements(s->'picks'->t) loop
   c=p->>'championId';if c is null or c!~'^[0-9]{1,5}$' or c=any(seen) then raise exception 'Champion already used or invalid';end if;seen=array_append(seen,c);
   if p->>'role' is null then raise exception 'Every pick must have a role';end if;
   if p->>'role' is not null then
    if p->>'role' not in ('Top','Jungle','Mid','ADC','Support') or p->>'role'=any(roles) then raise exception 'Role occupied or invalid';end if;roles=array_append(roles,p->>'role');
   end if;
  end loop;
  team_bans='{}';
  for p in select value from jsonb_array_elements(s->'bans'->t) loop
   if p='null'::jsonb then continue;end if;c=p#>>'{}';
   if jsonb_typeof(p)<>'string' or c!~'^[0-9]{1,5}$' or c=any(team_bans) or (c=any(seen) and not(coalesce(s->>'draftMode','')='ranked' and t='enemy' and s->'bans'->'ally' ? c and not exists(select 1 from jsonb_array_elements((s->'picks'->'ally')||(s->'picks'->'enemy')) x where x->>'championId'=c))) then raise exception 'Champion already used or invalid';end if;
   seen=array_append(seen,c);team_bans=array_append(team_bans,c);
  end loop;
 end loop;
 if jsonb_typeof(s->'history') is distinct from 'array' or jsonb_array_length(s->'history')>25 then raise exception 'Invalid history';end if;
 ds=s->'dataset';
 if jsonb_typeof(ds) is distinct from 'object' or jsonb_typeof(ds->'pairs') is distinct from 'array' or jsonb_array_length(ds->'pairs')>100000 then raise exception 'Invalid dataset';end if;
 foreach t in array array['id','patch','tier','source','importedAt'] loop
  if jsonb_typeof(ds->t) is distinct from 'string' or length(ds->>t)=0 then raise exception 'Missing metadata';end if;
 end loop;
 if jsonb_typeof(ds->'fictional') is distinct from 'boolean' then raise exception 'Dataset provenance required';end if;perform (ds->>'importedAt')::timestamptz;
 for p in select value from jsonb_array_elements(ds->'pairs') loop
  if coalesce(p->>'relation','') not in ('vs','with') or coalesce(p->>'candidateRole','') not in ('Top','Jungle','Mid','ADC','Support') or coalesce(p->>'otherRole','') not in ('Top','Jungle','Mid','ADC','Support') or coalesce(p->>'candidateChampionId','')!~'^[0-9]{1,5}$' or coalesce(p->>'otherChampionId','')!~'^[0-9]{1,5}$' then raise exception 'Invalid pair';end if;
  if p->'delta2' is null or (p->'delta2'<>'null'::jsonb and (jsonb_typeof(p->'delta2')<>'number' or abs((p->>'delta2')::numeric)>100)) then raise exception 'Invalid score';end if;
  if p->>'relation'='with' and p->>'candidateRole'=p->>'otherRole' then raise exception 'Invalid same-role synergy';end if;
  if p?'games' and (jsonb_typeof(p->'games')<>'number' or (p->>'games')::numeric<0 or (p->>'games')::numeric<>trunc((p->>'games')::numeric)) then raise exception 'Invalid games count';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(ds->'pairs') x group by x->>'relation',x->>'candidateChampionId',x->>'candidateRole',x->>'otherChampionId',x->>'otherRole' having count(*)>1) then raise exception 'Duplicate pair';end if;
end $$;
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
 if coalesce((prev->>'openDraft')::boolean,false) and not coalesce((s->>'openDraft')::boolean,false) and not exists(select 1 from public.draft_timelines h where h.room_id=new.id and h.restoring) then raise exception 'Use the host restart control to return to guided draft';end if;
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
create or replace function public.draft_assignments(s jsonb) returns jsonb language sql immutable set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_array(p->>'id',p->>'role') order by p->>'id'),'[]'::jsonb) from jsonb_array_elements(s->'players') p where not coalesce((p->>'observer')::boolean,false)
$$;
create or replace function public.control_draft(room_id uuid,expected_version integer,action text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.rooms;h public.draft_timelines;s jsonb;pos jsonb;log jsonb;
begin
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied';end if;
 if r.host_id is distinct from auth.uid() then raise exception 'Only the host can control draft history';end if;
 if r.version is distinct from expected_version then raise exception 'Conflict: room updated. Please try again.';end if;
 if r.state->>'phase'<>'live' then raise exception 'Start the draft first';end if;
 if action is null or action not in ('undo','redo','open','clear','guided','lobby') then raise exception 'Invalid draft control';end if;
 select * into h from public.draft_timelines where draft_timelines.room_id=r.id for update;s=r.state;
 if action in ('guided','lobby') then
  if action='guided' and not coalesce((s->>'openDraft')::boolean,false) then raise exception 'Draft is already guided';end if;
  s=s||'{"openDraft":false,"picks":{"ally":[],"enemy":[]},"bans":{"ally":[null,null,null,null,null],"enemy":[null,null,null,null,null]},"draftStep":0,"draftHistory":[]}'::jsonb;
  if action='lobby' then s=jsonb_set(s,'{phase}','"setup"');if s->>'draftMode'='ranked' then s=s#-'{rolePools,enemy}';end if;end if;
  h.undo='[]';h.redo='[]';
 elsif action='open' then
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
 select jsonb_agg(item order by ord) into log from jsonb_array_elements(jsonb_build_array(case action when 'open' then 'Open draft enabled' when 'guided' then 'Guided draft restarted' when 'lobby' then 'Returned to lobby' when 'clear' then 'Draft cleared' when 'undo' then 'Undo' else 'Redo' end)||(s->'history')) with ordinality x(item,ord) where ord<=25;
 s=jsonb_set(s,'{history}',log);perform public.validate_draft(s);
 delete from public.role_swap_requests where role_swap_requests.room_id=r.id;delete from public.pick_swap_requests where pick_swap_requests.room_id=r.id;
 update public.draft_timelines set undo=h.undo,redo=h.redo,restoring=true where draft_timelines.room_id=r.id;
 update public.rooms set state=s,version=version+1 where id=r.id returning * into r;
 update public.draft_timelines set restoring=false where draft_timelines.room_id=r.id;
 return to_jsonb(r);
end $$;
create or replace function public.leave_room(room_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare r public.rooms;remaining jsonb;next_host uuid;
begin
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied';end if;
 select coalesce(jsonb_agg(value order by position),'[]'::jsonb) into remaining from jsonb_array_elements(r.state->'players') with ordinality as player(value,position) where value->>'id'<>auth.uid()::text;
 if jsonb_array_length(remaining)=0 then delete from public.rooms where id=r.id;return;end if;
 next_host=case when r.host_id=auth.uid() then (select (p->>'id')::uuid from jsonb_array_elements(remaining) with ordinality x(p,pos) order by coalesce((p->>'observer')::boolean,false),pos limit 1) else r.host_id end;
 update public.rooms set host_id=next_host,version=version+1,state=jsonb_set(r.state,'{players}',remaining) where id=r.id;
 delete from public.room_members where room_members.room_id=r.id and user_id=auth.uid();
end $$;
-- Membership class can only be established by joining, never by a generic edit.
create function public.guard_participant_types() returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform public.validate_draft(new.state);
 if tg_op='UPDATE' and exists(select 1 from jsonb_array_elements(old.state->'players') a join jsonb_array_elements(new.state->'players') b on a->>'id'=b->>'id' where coalesce(a->'observer','false') is distinct from coalesce(b->'observer','false')) then raise exception 'Participant type is fixed when joining';end if;
 return new;
end $$;
create trigger guard_participant_types before insert or update of state on public.rooms for each row execute function public.guard_participant_types();

create function public.assert_room_editor(rid uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_room_member(rid) then raise exception 'Access denied';end if;
 if not exists(select 1 from public.rooms r where r.id=rid and (r.host_id=auth.uid() or exists(select 1 from jsonb_array_elements(r.state->'players') p where p->>'id'=auth.uid()::text and not coalesce((p->>'observer')::boolean,false)))) then raise exception 'Observers can watch but cannot edit the room';end if;
end $$;

-- Invitation needed for either seat class; observers may join an ongoing draft.
drop function public.join_room(text,text,text);
create function public.join_room(room_slug text,invite_token text,nickname text,as_observer boolean default false) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms;s jsonb;used integer;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select * into r from public.rooms where slug=room_slug for update;
 if not found then raise exception 'Room not found';end if;
 if public.is_room_member(r.id) then return to_jsonb(r);end if;
 if not exists(select 1 from public.room_invites i where i.room_id=r.id and i.token_hash=encode(sha256(convert_to(invite_token,'UTF8')),'hex')) then raise exception 'Invalid invitation';end if;
 if as_observer is null then raise exception 'Choose player or observer';end if;
 if not as_observer and r.state->>'phase'<>'setup' then raise exception 'Draft already started; join as an observer';end if;
 select count(*) into used from jsonb_array_elements(r.state->'players') p where coalesce((p->>'observer')::boolean,false)=as_observer;
 if used>=(case when as_observer then 3 else 5 end) then raise exception 'Room is full for % seats',case when as_observer then 'observer' else 'player' end;end if;
 if nickname is null or length(trim(nickname)) not between 1 and 32 then raise exception 'Invalid display name';end if;
 s=jsonb_set(r.state,'{players}',(r.state->'players')||jsonb_build_array(jsonb_build_object('id',auth.uid(),'name',trim(nickname),'role',null,'pool','[]'::jsonb,'observer',as_observer)));
 perform public.validate_draft(s);
 insert into public.room_members(room_id,user_id) values(r.id,auth.uid());
 update public.rooms set state=s,version=version+1 where id=r.id returning * into r;return to_jsonb(r);
end $$;
revoke all on function public.assert_room_editor(uuid),public.guard_participant_types(),public.join_room(text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.join_room(text,text,text,boolean) to authenticated;

create or replace function public.save_room(room_id uuid,expected_version integer,next_state jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms;p jsonb;oldp jsonb;host boolean;
begin
 perform public.assert_room_editor(room_id);
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied';end if;
 if r.version is distinct from expected_version then raise exception 'Conflict: room updated. Please try again.';end if;
 if octet_length(next_state::text)>12000000 then raise exception 'Room data is too large';end if;perform public.validate_draft(next_state);host=r.host_id=auth.uid();
 if (select array_agg(x->>'id' order by x->>'id') from jsonb_array_elements(next_state->'players') x) is distinct from (select array_agg(x->>'id' order by x->>'id') from jsonb_array_elements(r.state->'players') x) then raise exception 'Membership cannot be changed here';end if;
 if (not host or r.state->>'phase'<>'setup') and next_state->'dataset' is distinct from r.state->'dataset' then raise exception 'Dataset is locked or host-only';end if;
 if not host and (next_state->'phase' is distinct from r.state->'phase' or next_state->'side' is distinct from r.state->'side') then raise exception 'Host-only action';end if;
 if r.state->>'phase'='live' and next_state->>'phase'<>'live' then raise exception 'Draft already started';end if;
 for p in select value from jsonb_array_elements(next_state->'players') loop
  select value into oldp from jsonb_array_elements(r.state->'players') where value->>'id'=p->>'id';
  if p->>'id'<>auth.uid()::text and p->'role' is distinct from oldp->'role' then raise exception 'Request a role swap';end if;
  if not host and (p->>'id'<>auth.uid()::text or r.state->>'phase'<>'setup') and p is distinct from oldp then raise exception 'Pool or role cannot be edited';end if;
  if r.state->>'phase'<>'setup' and p->'role' is distinct from oldp->'role' then raise exception 'Roles are locked';end if;
 end loop;
 update public.rooms set state=next_state,version=version+1 where id=r.id returning * into r;return to_jsonb(r);
end $$;

create or replace function public.set_role_candidates(room_id uuid,team text,role text,champion_ids jsonb,expected_version integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.rooms;s jsonb;p jsonb;pools jsonb;
begin
 perform public.assert_room_editor(room_id);
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied';end if;
 if r.version is distinct from expected_version then raise exception 'Conflict: room updated. Please try again.';end if;
 if team is null or team not in ('ally','enemy') or role is null or role not in ('Top','Jungle','Mid','ADC','Support') then raise exception 'Invalid candidate seat';end if;
 perform public.validate_role_pool(champion_ids);s=r.state;
 if team='ally' then select value into p from jsonb_array_elements(s->'players') where value->>'role'=set_role_candidates.role;end if;
 if p is not null then
  if s->>'phase'='setup' and p->>'id'<>auth.uid()::text and r.host_id<>auth.uid() then raise exception 'Pool is owner or host only during preparation';end if;
  select jsonb_set(s,'{players}',jsonb_agg(case when value->>'id'=p->>'id' then jsonb_set(value,'{pool}',champion_ids) else value end order by pos)) into s from jsonb_array_elements(s->'players') with ordinality x(value,pos);
 else
  pools=coalesce(s->'rolePools','{}'::jsonb);pools=jsonb_set(pools,array[team],coalesce(pools->team,'{}'::jsonb));
  pools=jsonb_set(pools,array[team,role],champion_ids);s=jsonb_set(s,'{rolePools}',pools);
 end if;
 perform public.validate_draft(s);
 update public.rooms set state=s,version=version+1 where id=r.id returning * into r;return to_jsonb(r);
end $$;

create or replace function public.add_draft_candidate(room_id uuid,player_id uuid,champion_id text,expected_version integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms;p jsonb;s jsonb;
begin
 perform public.assert_room_editor(room_id);
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied';end if;
 if r.version is distinct from expected_version then raise exception 'Conflict: room updated. Please try again.';end if;
 if r.state->>'phase'<>'live' then raise exception 'Draft candidates can only be added during the draft';end if;
 if champion_id is null or champion_id !~ '^[0-9]{1,5}$' then raise exception 'Invalid champion';end if;
 select value into p from jsonb_array_elements(r.state->'players') where value->>'id'=player_id::text;
 if p is null or p->>'role' is null then raise exception 'Player must have an assigned role';end if;
 if p->'pool' ? champion_id then return to_jsonb(r);end if;
 select jsonb_set(r.state,'{players}',jsonb_agg(case when value->>'id'=player_id::text then jsonb_set(value,'{pool}',value->'pool'||jsonb_build_array(champion_id)) else value end order by position)) into s from jsonb_array_elements(r.state->'players') with ordinality as player(value,position);
 perform public.validate_draft(s);
 update public.rooms set state=s,version=version+1 where id=r.id returning * into r;
 return to_jsonb(r);
end $$;

create or replace function public.request_role_swap(room_id uuid,target_id uuid,expected_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms;mine text;theirs text;from_pick text;to_pick text;
begin
 perform public.assert_room_editor(room_id);
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied';end if;
 if r.version is distinct from expected_version then raise exception 'Conflict: room updated. Please try again.';end if;
 select p->>'role' into mine from jsonb_array_elements(r.state->'players') p where p->>'id'=auth.uid()::text;
 select p->>'role' into theirs from jsonb_array_elements(r.state->'players') p where p->>'id'=request_role_swap.target_id::text;
 if mine is null or theirs is null or auth.uid()=target_id or mine=theirs then raise exception 'Both players must have different roles';end if;
 delete from public.role_swap_requests q where q.room_id=r.id and q.expires_at<=clock_timestamp();
 if exists(select 1 from public.role_swap_requests q where q.room_id=r.id and (q.requester_id in (auth.uid(),request_role_swap.target_id) or q.target_id in (auth.uid(),request_role_swap.target_id))) then raise exception 'A role swap is already pending';end if;
 if exists(select 1 from public.pick_swap_requests q where q.room_id=r.id and q.expires_at>clock_timestamp() and (q.from_role in (mine,theirs) or q.to_role in (mine,theirs))) then raise exception 'A champion swap is already pending';end if;
 select p->>'championId' into from_pick from jsonb_array_elements(r.state->'picks'->'ally') p where p->>'role'=mine;
 select p->>'championId' into to_pick from jsonb_array_elements(r.state->'picks'->'ally') p where p->>'role'=theirs;
 insert into public.role_swap_requests(room_id,requester_id,target_id,from_role,to_role,phase,from_champion_id,to_champion_id)
 values(r.id,auth.uid(),target_id,mine,theirs,r.state->>'phase',from_pick,to_pick);
 update public.rooms set version=version+1 where id=r.id returning * into r;return to_jsonb(r);
end $$;

create or replace function public.respond_role_swap(room_id uuid,request_id uuid,accept boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms;q public.role_swap_requests;s jsonb;
begin
 perform public.assert_room_editor(room_id);
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied';end if;
 select * into q from public.role_swap_requests where id=request_id and role_swap_requests.room_id=r.id for update;
 if not found then return to_jsonb(r);end if;
 if accept is null or (accept and auth.uid()<>q.target_id) or (not accept and auth.uid() not in (q.requester_id,q.target_id)) then raise exception 'Only the requested player can accept';end if;
 if not accept or q.expires_at<=clock_timestamp() then
  delete from public.role_swap_requests where id=q.id;update public.rooms set version=version+1 where id=r.id returning * into r;return to_jsonb(r);
 end if;
 if r.state->>'phase' is distinct from q.phase
  or not exists(select 1 from jsonb_array_elements(r.state->'players') p where p->>'id'=q.requester_id::text and p->>'role'=q.from_role)
  or not exists(select 1 from jsonb_array_elements(r.state->'players') p where p->>'id'=q.target_id::text and p->>'role'=q.to_role) then raise exception 'Roles have changed';end if;
 if q.phase='live' then
  if (select p->>'championId' from jsonb_array_elements(r.state->'picks'->'ally') p where p->>'role'=q.from_role) is distinct from q.from_champion_id
    or (select p->>'championId' from jsonb_array_elements(r.state->'picks'->'ally') p where p->>'role'=q.to_role) is distinct from q.to_champion_id then raise exception 'Champion selections changed';end if;
  update public.role_swap_requests set accepted=true where id=q.id;
  s=public.exchange_live_roles(r.state,q.from_role,q.to_role);
 else
  select jsonb_set(r.state,'{players}',jsonb_agg(case when p->>'id'=q.requester_id::text then jsonb_set(p,'{role}',to_jsonb(q.to_role)) when p->>'id'=q.target_id::text then jsonb_set(p,'{role}',to_jsonb(q.from_role)) else p end order by pos)) into s from jsonb_array_elements(r.state->'players') with ordinality x(p,pos);
 end if;
 perform public.validate_draft(s);
 update public.rooms set state=s,version=version+1 where id=r.id returning * into r;
 delete from public.role_swap_requests where id=q.id;return to_jsonb(r);
end $$;

create or replace function public.move_draft_pick(room_id uuid,team text,from_role text,to_role text,expected_version integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.rooms; moving text; target text; a uuid; b uuid; next_picks jsonb; s jsonb;
begin
 perform public.assert_room_editor(room_id);
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied';end if;
 if r.version is distinct from expected_version then raise exception 'Conflict: room updated. Please try again.';end if;
 if r.state->>'phase'<>'live' then raise exception 'Champion moves are only available during the draft';end if;
 if team is null or team not in ('ally','enemy') or from_role is null or to_role is null
  or from_role not in ('Top','Jungle','Mid','ADC','Support') or to_role not in ('Top','Jungle','Mid','ADC','Support') then raise exception 'Invalid pick move';end if;
 select p->>'championId' into moving from jsonb_array_elements(r.state->'picks'->team) p where p->>'role'=from_role;
 if moving is null then raise exception 'No selected champion to move';end if;
 if from_role=to_role then return to_jsonb(r);end if;
 select p->>'championId' into target from jsonb_array_elements(r.state->'picks'->team) p where p->>'role'=to_role;
 if team='ally' then
  select (p->>'id')::uuid into a from jsonb_array_elements(r.state->'players') p where p->>'role'=from_role;
  select (p->>'id')::uuid into b from jsonb_array_elements(r.state->'players') p where p->>'role'=to_role;
 end if;
 delete from public.pick_swap_requests q where q.room_id=r.id and q.expires_at<=clock_timestamp();
 if team='ally' and exists(select 1 from public.pick_swap_requests q where q.room_id=r.id and
   (q.from_role in (move_draft_pick.from_role,move_draft_pick.to_role) or q.to_role in (move_draft_pick.from_role,move_draft_pick.to_role))) then
  raise exception 'A champion swap is already pending';
 end if;
 if a is not null and b is not null then
  insert into public.pick_swap_requests(room_id,requester_id,from_role,to_role,from_player_id,to_player_id,from_champion_id,to_champion_id,from_accepted,to_accepted)
   values(r.id,auth.uid(),from_role,to_role,a,b,moving,target,a=auth.uid(),b=auth.uid());
  update public.rooms set version=version+1 where id=r.id returning * into r;
 else
  select coalesce(jsonb_agg(case when p->>'role'=from_role then jsonb_set(p,'{role}',to_jsonb(to_role)) when p->>'role'=to_role then jsonb_set(p,'{role}',to_jsonb(from_role)) else p end order by position),'[]'::jsonb)
   into next_picks from jsonb_array_elements(r.state->'picks'->team) with ordinality as picks(p,position);
  s=jsonb_set(r.state,array['picks',team],next_picks);
  perform public.validate_draft(s);
  update public.rooms set state=s,version=version+1 where id=r.id returning * into r;
 end if;
 return to_jsonb(r);
end $$;

create or replace function public.respond_pick_swap(room_id uuid,request_id uuid,accept boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.rooms; q public.pick_swap_requests; s jsonb; next_picks jsonb;
begin
 perform public.assert_room_editor(room_id);
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied';end if;
 select * into q from public.pick_swap_requests where id=request_id and pick_swap_requests.room_id=r.id for update;
 if not found then return to_jsonb(r);end if;
 if accept is null or (accept and auth.uid() not in (q.from_player_id,q.to_player_id))
  or (not accept and auth.uid() not in (q.requester_id,q.from_player_id,q.to_player_id)) then raise exception 'Only the affected players can accept';end if;
 if not accept or q.expires_at<=clock_timestamp() then
  delete from public.pick_swap_requests where id=q.id;
  update public.rooms set version=version+1 where id=r.id returning * into r;
  return to_jsonb(r);
 end if;
 if r.state->>'phase'<>'live'
  or not exists(select 1 from jsonb_array_elements(r.state->'players') p where p->>'id'=q.from_player_id::text and p->>'role'=q.from_role)
  or not exists(select 1 from jsonb_array_elements(r.state->'players') p where p->>'id'=q.to_player_id::text and p->>'role'=q.to_role)
  or (select p->>'championId' from jsonb_array_elements(r.state->'picks'->'ally') p where p->>'role'=q.from_role) is distinct from q.from_champion_id
  or (select p->>'championId' from jsonb_array_elements(r.state->'picks'->'ally') p where p->>'role'=q.to_role) is distinct from q.to_champion_id then
  raise exception 'Champion selections changed; please try again';
 end if;
 update public.pick_swap_requests set from_accepted=from_accepted or auth.uid()=from_player_id,
   to_accepted=to_accepted or auth.uid()=to_player_id where id=q.id returning * into q;
 if q.from_accepted and q.to_accepted then
  select jsonb_agg(case when p->>'role'=q.from_role then jsonb_set(p,'{role}',to_jsonb(q.to_role)) when p->>'role'=q.to_role then jsonb_set(p,'{role}',to_jsonb(q.from_role)) else p end order by position)
   into next_picks from jsonb_array_elements(r.state->'picks'->'ally') with ordinality as picks(p,position);
  s=jsonb_set(r.state,'{picks,ally}',next_picks);
  perform public.validate_draft(s);
  update public.rooms set state=s,version=version+1 where id=r.id returning * into r;
  delete from public.pick_swap_requests where id=q.id;
 else
  update public.rooms set version=version+1 where id=r.id returning * into r;
 end if;
 return to_jsonb(r);
end $$;

create or replace function public.move_live_role(room_id uuid,to_role text,expected_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms;mine text;target uuid;s jsonb;
begin
 perform public.assert_room_editor(room_id);
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied';end if;
 if r.version is distinct from expected_version then raise exception 'Conflict: room updated. Please try again.';end if;
 if r.state->>'phase'<>'live' then raise exception 'Live role moves require a draft';end if;
 if to_role is null or to_role not in ('Top','Jungle','Mid','ADC','Support') then raise exception 'Invalid target role';end if;
 select p->>'role' into mine from jsonb_array_elements(r.state->'players') p where p->>'id'=auth.uid()::text;
 if mine is null then raise exception 'Choose a role during preparation first';end if;
 if mine=to_role then return to_jsonb(r);end if;
 select (p->>'id')::uuid into target from jsonb_array_elements(r.state->'players') p where p->>'role'=to_role;
 if target is not null then return public.request_role_swap(r.id,target,expected_version);end if;
 if exists(select 1 from public.role_swap_requests q where q.room_id=r.id and q.expires_at>clock_timestamp() and (q.from_role in (mine,move_live_role.to_role) or q.to_role in (mine,move_live_role.to_role)))
  or exists(select 1 from public.pick_swap_requests q where q.room_id=r.id and q.expires_at>clock_timestamp() and (q.from_role in (mine,move_live_role.to_role) or q.to_role in (mine,move_live_role.to_role))) then raise exception 'A swap is already pending';end if;
 s=public.exchange_live_roles(r.state,mine,to_role);perform public.validate_draft(s);
 update public.rooms set state=s,version=version+1 where id=r.id returning * into r;return to_jsonb(r);
end $$;
notify pgrst,'reload schema';
commit;
