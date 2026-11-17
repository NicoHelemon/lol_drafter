-- Direct picks belong to their occupied role; candidate lists stay collaborative.
begin;
create function public.guard_pick_ownership() returns trigger language plpgsql security definer set search_path=public as $$
declare p jsonb;before_champion text;after_champion text;
begin
 if old.host_id=auth.uid() then return new;end if;
 -- guard_live_roles validates these transitions, including consent and exact pick preservation.
 if old.state->>'phase'='live' and public.draft_assignments(old.state) is distinct from public.draft_assignments(new.state) then return new;end if;
 for p in select value from jsonb_array_elements(old.state->'players') loop
  if p->>'role' is null or p->>'id'=auth.uid()::text then continue;end if;
  select x->>'championId' into before_champion from jsonb_array_elements(old.state->'picks'->'ally') x where x->>'role'=p->>'role';
  select x->>'championId' into after_champion from jsonb_array_elements(new.state->'picks'->'ally') x where x->>'role'=p->>'role';
  if before_champion is not distinct from after_champion then continue;end if;
  if exists(select 1 from public.pick_swap_requests q where q.room_id=old.id and q.from_accepted and q.to_accepted and q.expires_at>clock_timestamp()
   and exists(select 1 from jsonb_array_elements(old.state->'players') m where m->>'id'=q.from_player_id::text and m->>'role'=q.from_role)
   and exists(select 1 from jsonb_array_elements(old.state->'players') m where m->>'id'=q.to_player_id::text and m->>'role'=q.to_role)
   and (select x->>'championId' from jsonb_array_elements(old.state->'picks'->'ally') x where x->>'role'=q.from_role) is not distinct from q.from_champion_id
   and (select x->>'championId' from jsonb_array_elements(old.state->'picks'->'ally') x where x->>'role'=q.to_role) is not distinct from q.to_champion_id
   and ((p->>'role'=q.from_role and after_champion is not distinct from q.to_champion_id) or (p->>'role'=q.to_role and after_champion is not distinct from q.from_champion_id))) then continue;end if;
  raise exception 'Only the role owner or host can change this selection';
 end loop;return new;
end $$;
create trigger guard_pick_ownership before update of state on public.rooms for each row execute function public.guard_pick_ownership();
revoke all on function public.guard_pick_ownership() from public,anon,authenticated;

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
  select jsonb_set(s,'{players}',jsonb_agg(case when value->>'id'=p->>'id' then jsonb_set(value,'{pool}',champion_ids) else value end order by pos)) into s from jsonb_array_elements(s->'players') with ordinality x(value,pos);
 else
  pools=coalesce(s->'rolePools','{}'::jsonb);pools=jsonb_set(pools,array[team],coalesce(pools->team,'{}'::jsonb));
  pools=jsonb_set(pools,array[team,role],champion_ids);s=jsonb_set(s,'{rolePools}',pools);
 end if;
 perform public.validate_draft(s);
 update public.rooms set state=s,version=version+1 where id=r.id returning * into r;return to_jsonb(r);
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
 if team='ally' and r.host_id<>auth.uid() and ((a is not null and a<>auth.uid()) or (a is null and b is not null and b<>auth.uid())) then raise exception 'Only the role owner or host can change this selection';end if;
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
notify pgrst,'reload schema';
commit;
