-- Disposable-room schema update. Run after migrations 001–003.
-- Existing temporary rooms, memberships, invitations and swap requests are cleared.
begin;
delete from public.rooms;
alter table public.rooms add column slug text not null unique;
alter table public.rooms add column name text not null;
alter table public.role_swap_requests add column expires_at timestamptz not null default (clock_timestamp()+interval '5 seconds');
drop function if exists public.end_room(uuid,integer);
drop function if exists public.join_room(uuid,text,text);
drop function if exists public.leave_room(uuid,integer);
drop trigger if exists guard_role_swaps on public.rooms;
drop function if exists public.guard_role_swaps();

create or replace function public.validate_draft(s jsonb) returns void language plpgsql set search_path=public as $$
declare t text;p jsonb;c text;seen text[]='{}';roles text[];seats text[]='{}';ids text[]='{}';ds jsonb;
begin
 if coalesce(s->>'phase','') not in ('setup','live') or coalesce(s->>'side','') not in ('blue','red') then raise exception 'Invalid room state';end if;
 if jsonb_typeof(s->'players') is distinct from 'array' or jsonb_array_length(s->'players') not between 1 and 5 then raise exception 'Up to five players allowed';end if;
 for p in select value from jsonb_array_elements(s->'players') loop
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
   if p->>'role' is not null then
    if p->>'role' not in ('Top','Jungle','Mid','ADC','Support') or p->>'role'=any(roles) then raise exception 'Role occupied or invalid';end if;roles=array_append(roles,p->>'role');
   end if;
  end loop;
  for p in select value from jsonb_array_elements(s->'bans'->t) loop
   if p='null'::jsonb then continue;end if;c=p#>>'{}';if jsonb_typeof(p)<>'string' or c!~'^[0-9]{1,5}$' or c=any(seen) then raise exception 'Champion already used or invalid';end if;seen=array_append(seen,c);
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

create or replace function public.create_room(initial_state jsonb,invite_token text) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms;label text;base text;candidate text;attempt integer=1;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 if invite_token is null or length(invite_token) not between 64 and 128 then raise exception 'Invalid invitation';end if;
 perform public.validate_draft(initial_state);
 if jsonb_array_length(initial_state->'players')<>1 or initial_state->'players'->0->>'id'<>auth.uid()::text or initial_state->>'phase'<>'setup' then raise exception 'Invalid creator';end if;
 label=initial_state->'players'->0->>'name';base=trim(both '-' from regexp_replace(lower(label),'[^a-z0-9]+','-','g'));if base='' then base='player';end if;base=base||'s-room';
 loop
  candidate=base||case when attempt=1 then '' else '-'||attempt::text end;
  insert into public.rooms(host_id,state,slug,name) values(auth.uid(),initial_state,candidate,label||'''s room') on conflict(slug) do nothing returning * into r;
  exit when found;attempt=attempt+1;
 end loop;
 insert into public.room_members(room_id,user_id) values(r.id,auth.uid());
 insert into public.room_invites values(r.id,encode(sha256(convert_to(invite_token,'UTF8')),'hex'));
 return to_jsonb(r);
end $$;
create function public.join_room(room_slug text,invite_token text,nickname text) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms;s jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select * into r from public.rooms where slug=room_slug for update;
 if not found then raise exception 'Room not found';end if;
 if public.is_room_member(r.id) then return to_jsonb(r);end if;
 if not exists(select 1 from public.room_invites i where i.room_id=r.id and i.token_hash=encode(sha256(convert_to(invite_token,'UTF8')),'hex')) then raise exception 'Invalid invitation';end if;
 if r.state->>'phase'<>'setup' then raise exception 'Draft already started';end if;
 if jsonb_array_length(r.state->'players')>=5 then raise exception 'Room is full';end if;
 if nickname is null or length(trim(nickname)) not between 1 and 32 then raise exception 'Invalid display name';end if;
 s=jsonb_set(r.state,'{players}',(r.state->'players')||jsonb_build_array(jsonb_build_object('id',auth.uid(),'name',trim(nickname),'role',null,'pool','[]'::jsonb)));
 insert into public.room_members(room_id,user_id) values(r.id,auth.uid());
 update public.rooms set state=s,version=version+1 where id=r.id returning * into r;return to_jsonb(r);
end $$;
create or replace function public.save_room(room_id uuid,expected_version integer,next_state jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms;p jsonb;oldp jsonb;host boolean;
begin
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
create function public.leave_room(room_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare r public.rooms;remaining jsonb;next_host uuid;
begin
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied';end if;
 select coalesce(jsonb_agg(value order by position),'[]'::jsonb) into remaining from jsonb_array_elements(r.state->'players') with ordinality as player(value,position) where value->>'id'<>auth.uid()::text;
 if jsonb_array_length(remaining)=0 then delete from public.rooms where id=r.id;return;end if;
 next_host=case when r.host_id=auth.uid() then (remaining->0->>'id')::uuid else r.host_id end;
 update public.rooms set host_id=next_host,version=version+1,state=jsonb_set(r.state,'{players}',remaining) where id=r.id;
 delete from public.room_members where room_members.room_id=r.id and user_id=auth.uid();
end $$;

create or replace function public.request_role_swap(room_id uuid,target_id uuid,expected_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms;mine text;theirs text;
begin
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied';end if;
 if r.version is distinct from expected_version then raise exception 'Conflict: room updated. Please try again.';end if;
 if r.state->>'phase'<>'setup' then raise exception 'Role swaps are only available during preparation';end if;
 delete from public.role_swap_requests s where s.room_id=r.id and s.expires_at<=clock_timestamp();
 select p->>'role' into mine from jsonb_array_elements(r.state->'players') p where p->>'id'=auth.uid()::text;
 select p->>'role' into theirs from jsonb_array_elements(r.state->'players') p where p->>'id'=request_role_swap.target_id::text;
 if mine is null or theirs is null or auth.uid()=target_id or mine=theirs then raise exception 'Both players must have different roles';end if;
 if exists(select 1 from public.role_swap_requests s where s.room_id=r.id and (s.requester_id in (auth.uid(),request_role_swap.target_id) or s.target_id in (auth.uid(),request_role_swap.target_id))) then raise exception 'A role swap is already pending';end if;
 insert into public.role_swap_requests(room_id,requester_id,target_id,from_role,to_role) values(r.id,auth.uid(),request_role_swap.target_id,mine,theirs);
 update public.rooms set version=version+1 where id=r.id returning * into r;return to_jsonb(r);
end $$;
drop function public.respond_role_swap(uuid,uuid,boolean,integer);
create function public.respond_role_swap(room_id uuid,request_id uuid,accept boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms;request public.role_swap_requests;s jsonb;
begin
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied';end if;
 select * into request from public.role_swap_requests where id=request_id and role_swap_requests.room_id=r.id;
 if not found then return to_jsonb(r);end if;
 if accept is null or (accept and auth.uid()<>request.target_id) or (not accept and auth.uid() not in (request.requester_id,request.target_id)) then raise exception 'Only the requested player can accept';end if;
 if not accept or request.expires_at<=clock_timestamp() then
  delete from public.role_swap_requests where id=request.id;
  update public.rooms set version=version+1 where id=r.id returning * into r;return to_jsonb(r);
 end if;
 if r.state->>'phase'<>'setup' then raise exception 'Role swap no longer available';end if;
 if not exists(select 1 from jsonb_array_elements(r.state->'players') p where p->>'id'=request.requester_id::text and p->>'role'=request.from_role) or not exists(select 1 from jsonb_array_elements(r.state->'players') p where p->>'id'=request.target_id::text and p->>'role'=request.to_role) then raise exception 'Roles have changed';end if;
 select jsonb_set(r.state,'{players}',jsonb_agg(case when p->>'id'=request.requester_id::text then jsonb_set(p,'{role}',to_jsonb(request.to_role)) when p->>'id'=request.target_id::text then jsonb_set(p,'{role}',to_jsonb(request.from_role)) else p end order by position)) into s from jsonb_array_elements(r.state->'players') with ordinality as player(p,position);
 delete from public.role_swap_requests where id=request.id;
 update public.rooms set state=s,version=version+1 where id=r.id returning * into r;return to_jsonb(r);
end $$;
revoke execute on function public.join_room(text,text,text),public.leave_room(uuid),public.respond_role_swap(uuid,uuid,boolean) from public;
grant execute on function public.join_room(text,text,text),public.leave_room(uuid),public.respond_role_swap(uuid,uuid,boolean) to authenticated;
commit;
