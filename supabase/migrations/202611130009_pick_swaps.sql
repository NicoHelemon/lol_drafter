-- Selected-champion moves; independent from lobby role swaps. No data reset.
begin;
create table public.pick_swap_requests (
 id uuid primary key default gen_random_uuid(),
 room_id uuid not null references public.rooms(id) on delete cascade,
 requester_id uuid not null references auth.users(id),
 from_role text not null check(from_role in ('Top','Jungle','Mid','ADC','Support')),
 to_role text not null check(to_role in ('Top','Jungle','Mid','ADC','Support') and to_role<>from_role),
 from_player_id uuid not null references auth.users(id),
 to_player_id uuid not null references auth.users(id) check(to_player_id<>from_player_id),
 from_champion_id text not null check(from_champion_id ~ '^[0-9]{1,5}$'),
 to_champion_id text check(to_champion_id ~ '^[0-9]{1,5}$'),
 from_accepted boolean not null default false,
 to_accepted boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '5 seconds'
);
create index pick_swaps_room on public.pick_swap_requests(room_id);
alter table public.pick_swap_requests enable row level security;
create policy members_read_pick_swaps on public.pick_swap_requests for select to authenticated using(public.is_room_member(room_id));
revoke all on public.pick_swap_requests from anon,authenticated;
grant select on public.pick_swap_requests to authenticated;

-- Transfers between two occupied allied roles require an actual approved row,
-- not a client-controlled flag. Generic save_room cannot bypass consent.
create function public.guard_pick_transfers() returns trigger language plpgsql set search_path=public as $$
declare p jsonb; target_role text; source_owner text; target_owner text; old_target text;
begin
 if old.state->>'phase'<>'live' then return new;end if;
 for p in select value from jsonb_array_elements(old.state->'picks'->'ally') loop
  select x->>'role' into target_role from jsonb_array_elements(new.state->'picks'->'ally') x where x->>'championId'=p->>'championId';
  if target_role is null or target_role=p->>'role' then continue;end if;
  select x->>'id' into source_owner from jsonb_array_elements(old.state->'players') x where x->>'role'=p->>'role';
  select x->>'id' into target_owner from jsonb_array_elements(old.state->'players') x where x->>'role'=target_role;
  if source_owner is null or target_owner is null then continue;end if;
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
create trigger guard_pick_transfers before update of state on public.rooms for each row execute function public.guard_pick_transfers();

create function public.prune_pick_swaps() returns trigger language plpgsql security definer set search_path=public as $$
begin
 delete from public.pick_swap_requests q where q.room_id=new.id and (
   q.expires_at<=clock_timestamp() or new.state->>'phase'<>'live'
   or not exists(select 1 from jsonb_array_elements(new.state->'players') p where p->>'id'=q.requester_id::text)
   or not exists(select 1 from jsonb_array_elements(new.state->'players') p where p->>'id'=q.from_player_id::text and p->>'role'=q.from_role)
   or not exists(select 1 from jsonb_array_elements(new.state->'players') p where p->>'id'=q.to_player_id::text and p->>'role'=q.to_role)
   or (select p->>'championId' from jsonb_array_elements(new.state->'picks'->'ally') p where p->>'role'=q.from_role) is distinct from q.from_champion_id
   or (select p->>'championId' from jsonb_array_elements(new.state->'picks'->'ally') p where p->>'role'=q.to_role) is distinct from q.to_champion_id);
 return new;
end $$;
create trigger prune_pick_swaps after update of state on public.rooms for each row execute function public.prune_pick_swaps();

create function public.move_draft_pick(room_id uuid,team text,from_role text,to_role text,expected_version integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.rooms; moving text; target text; a uuid; b uuid; next_picks jsonb; s jsonb;
begin
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

create function public.respond_pick_swap(room_id uuid,request_id uuid,accept boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.rooms; q public.pick_swap_requests; s jsonb; next_picks jsonb;
begin
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
revoke all on function public.guard_pick_transfers(),public.prune_pick_swaps(),public.move_draft_pick(uuid,text,text,text,integer),public.respond_pick_swap(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.move_draft_pick(uuid,text,text,text,integer),public.respond_pick_swap(uuid,uuid,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
