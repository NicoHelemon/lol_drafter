-- A candidate is a pool entry, not an actual pick. No room data is deleted.
begin;
create or replace function public.add_draft_candidate(room_id uuid,player_id uuid,champion_id text,expected_version integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms;p jsonb;s jsonb;
begin
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
revoke execute on function public.add_draft_candidate(uuid,uuid,text,integer) from public;
grant execute on function public.add_draft_candidate(uuid,uuid,text,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
