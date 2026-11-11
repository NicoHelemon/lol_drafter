-- Apply once after 202611110001_draftroom.sql. Existing rooms and datasets are preserved.
begin;
create or replace function public.leave_room(room_id uuid, expected_version integer)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; remaining jsonb; next_host uuid; label text;
begin
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied'; end if;
 if r.version is distinct from expected_version then raise exception 'Conflict: room updated. Please try again.'; end if;
 select value->>'name' into label from jsonb_array_elements(r.state->'players') where value->>'id'=auth.uid()::text;
 select coalesce(jsonb_agg(value order by position),'[]'::jsonb) into remaining
 from jsonb_array_elements(r.state->'players') with ordinality as player(value,position)
 where value->>'id'<>auth.uid()::text;
 if jsonb_array_length(remaining)=0 then
  delete from public.rooms where id=r.id;
  return;
 end if;
 next_host=case when r.host_id=auth.uid() then (remaining->0->>'id')::uuid else r.host_id end;
 update public.rooms set host_id=next_host, version=version+1,
 state=jsonb_set(jsonb_set(r.state,'{players}',remaining),'{history}',
  (select coalesce(jsonb_agg(value order by position),'[]'::jsonb)
   from jsonb_array_elements(jsonb_build_array(label||' left the room')||(r.state->'history')) with ordinality as event(value,position) where position<=25))
 where id=r.id;
 delete from public.room_members where room_members.room_id=r.id and user_id=auth.uid();
end $$;
create or replace function public.end_room(room_id uuid, expected_version integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) or r.host_id<>auth.uid() then raise exception 'Only the host can end this room'; end if;
 if r.version is distinct from expected_version then raise exception 'Conflict: room updated. Please try again.'; end if;
 if r.state->>'phase'='finished' then return to_jsonb(r); end if;
 update public.rooms set version=version+1,
 state=jsonb_set(jsonb_set(r.state,'{phase}','"finished"'::jsonb),'{history}',
  (select coalesce(jsonb_agg(value order by position),'[]'::jsonb)
   from jsonb_array_elements(jsonb_build_array('Room ended')||(r.state->'history')) with ordinality as event(value,position) where position<=25))
 where id=r.id returning * into r;
 return to_jsonb(r);
end $$;
revoke execute on function public.leave_room(uuid,integer),public.end_room(uuid,integer) from public;
grant execute on function public.leave_room(uuid,integer),public.end_room(uuid,integer) to authenticated;
commit;
