-- Extend the existing consent mechanism. No room, pool or statistic reset.
begin;
alter table public.role_swap_requests
 add column phase text not null default 'setup' check(phase in ('setup','live')),
 add column from_champion_id text,
 add column to_champion_id text,
 add column accepted boolean not null default false;

create function public.exchange_live_roles(s jsonb,from_role text,to_role text) returns jsonb
language plpgsql set search_path=public as $$
declare players jsonb;picks jsonb;
begin
 select jsonb_agg(case when p->>'role'=from_role then jsonb_set(p,'{role}',to_jsonb(to_role))
  when p->>'role'=to_role then jsonb_set(p,'{role}',to_jsonb(from_role)) else p end order by pos)
  into players from jsonb_array_elements(s->'players') with ordinality x(p,pos);
 select coalesce(jsonb_agg(case when p->>'role'=from_role then jsonb_set(p,'{role}',to_jsonb(to_role))
  when p->>'role'=to_role then jsonb_set(p,'{role}',to_jsonb(from_role)) else p end order by pos),'[]'::jsonb)
  into picks from jsonb_array_elements(s->'picks'->'ally') with ordinality x(p,pos);
 return jsonb_set(jsonb_set(s,'{players}',players),'{picks,ally}',picks);
end $$;
revoke all on function public.exchange_live_roles(jsonb,text,text) from public,anon,authenticated;

create function public.guard_live_roles() returns trigger language plpgsql security definer set search_path=public as $$
declare p jsonb;before_role text;after_role text;changed_id text;expected jsonb;
begin
 if old.state->>'phase'<>'live' then return new;end if;
 for p in select value from jsonb_array_elements(new.state->'players') loop
  select x->>'role' into before_role from jsonb_array_elements(old.state->'players') x where x->>'id'=p->>'id';
  if p->>'role' is distinct from before_role then changed_id=p->>'id';after_role=p->>'role';exit;end if;
 end loop;
 if changed_id is null then return new;end if;
 if before_role is null or after_role is null then raise exception 'Use a live role move';end if;
 if exists(select 1 from jsonb_array_elements(old.state->'players') x where x->>'role'=after_role) then
  if not exists(select 1 from public.role_swap_requests q where q.room_id=old.id and q.phase='live'
   and q.accepted and q.expires_at>clock_timestamp()
   and ((q.from_role=before_role and q.to_role=after_role) or (q.to_role=before_role and q.from_role=after_role))
   and exists(select 1 from jsonb_array_elements(old.state->'players') x where x->>'id'=q.requester_id::text and x->>'role'=q.from_role)
   and exists(select 1 from jsonb_array_elements(old.state->'players') x where x->>'id'=q.target_id::text and x->>'role'=q.to_role)
   and (select x->>'championId' from jsonb_array_elements(old.state->'picks'->'ally') x where x->>'role'=q.from_role) is not distinct from q.from_champion_id
   and (select x->>'championId' from jsonb_array_elements(old.state->'picks'->'ally') x where x->>'role'=q.to_role) is not distinct from q.to_champion_id)
  then raise exception 'Live role exchanges require player consent';end if;
 elsif changed_id is distinct from auth.uid()::text then raise exception 'Only move your own role';end if;
 expected=public.exchange_live_roles(old.state,before_role,after_role);
 if new.state->'players' is distinct from expected->'players'
  or new.state->'picks'->'ally' is distinct from expected->'picks'->'ally'
  or new.state->'picks'->'enemy' is distinct from old.state->'picks'->'enemy'
  or new.state->'dataset' is distinct from old.state->'dataset'
 then raise exception 'A role move must preserve players, pools and their selected champions';end if;
 return new;
end $$;
revoke all on function public.guard_live_roles() from public,anon,authenticated;
create trigger guard_live_roles before update of state on public.rooms for each row execute function public.guard_live_roles();

create or replace function public.clean_role_swaps() returns trigger language plpgsql security definer set search_path=public as $$
begin
 delete from public.role_swap_requests q where q.room_id=new.id and (
  q.expires_at<=clock_timestamp() or new.state->>'phase' is distinct from q.phase
  or not exists(select 1 from jsonb_array_elements(new.state->'players') p where p->>'id'=q.requester_id::text and p->>'role'=q.from_role)
  or not exists(select 1 from jsonb_array_elements(new.state->'players') p where p->>'id'=q.target_id::text and p->>'role'=q.to_role)
  or (q.phase='live' and ((select p->>'championId' from jsonb_array_elements(new.state->'picks'->'ally') p where p->>'role'=q.from_role) is distinct from q.from_champion_id
    or (select p->>'championId' from jsonb_array_elements(new.state->'picks'->'ally') p where p->>'role'=q.to_role) is distinct from q.to_champion_id)));
 return new;
end $$;

create function public.guard_pick_role_overlap() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from public.role_swap_requests q where q.room_id=new.room_id and q.expires_at>clock_timestamp()
   and (q.from_role in (new.from_role,new.to_role) or q.to_role in (new.from_role,new.to_role)))
 then raise exception 'A role swap is already pending';end if;
 return new;
end $$;
revoke all on function public.guard_pick_role_overlap() from public,anon,authenticated;
create trigger guard_pick_role_overlap before insert on public.pick_swap_requests for each row execute function public.guard_pick_role_overlap();

create or replace function public.request_role_swap(room_id uuid,target_id uuid,expected_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms;mine text;theirs text;from_pick text;to_pick text;
begin
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

create function public.move_live_role(room_id uuid,to_role text,expected_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms;mine text;target uuid;s jsonb;
begin
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
revoke all on function public.move_live_role(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.move_live_role(uuid,text,integer) to authenticated;

create or replace function public.respond_role_swap(room_id uuid,request_id uuid,accept boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms;q public.role_swap_requests;s jsonb;
begin
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
create or replace function public.guard_pick_transfers() returns trigger language plpgsql set search_path=public as $$
declare p jsonb; target_role text; source_owner text; target_owner text; old_target text;
begin
 if old.state->>'phase'<>'live' then return new;end if;
 for p in select value from jsonb_array_elements(old.state->'picks'->'ally') loop
  select x->>'role' into target_role from jsonb_array_elements(new.state->'picks'->'ally') x where x->>'championId'=p->>'championId';
  if target_role is null or target_role=p->>'role' then continue;end if;
  select x->>'id' into source_owner from jsonb_array_elements(old.state->'players') x where x->>'role'=p->>'role';
  select x->>'id' into target_owner from jsonb_array_elements(old.state->'players') x where x->>'role'=target_role;
  if source_owner is null or target_owner is null then continue;end if;
  -- A consent-checked role exchange carries the same owner's selection.
  if exists(select 1 from jsonb_array_elements(new.state->'players') x where x->>'id'=source_owner and x->>'role'=target_role) then continue;end if;
  select x->>'championId' into old_target from jsonb_array_elements(old.state->'picks'->'ally') x where x->>'role'=target_role;
  if not exists(select 1 from public.pick_swap_requests q where q.room_id=old.id
    and q.from_accepted and q.to_accepted and q.expires_at>clock_timestamp()
    and ((q.from_role=p->>'role' and q.to_role=target_role and q.from_player_id::text=source_owner
       and q.to_player_id::text=target_owner and q.from_champion_id=p->>'championId' and q.to_champion_id is not distinct from old_target)
     or (q.to_role=p->>'role' and q.from_role=target_role and q.to_player_id::text=source_owner
       and q.from_player_id::text=target_owner and q.to_champion_id=p->>'championId' and q.from_champion_id is not distinct from old_target))) then
   raise exception 'Selected champion transfers between players require consent';
  end if;
 end loop;
 return new;
end $$;

notify pgrst,'reload schema';
commit;
