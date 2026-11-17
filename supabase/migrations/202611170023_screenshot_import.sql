-- Append-only host import; one transaction and one choice-history checkpoint.
begin;
create function public.import_draft_screenshot(room_id uuid,expected_version integer,additions jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.rooms;h public.draft_timelines;s jsonb;base jsonb;item jsonb;team text;role text;champ text;slot integer;n integer=0;
begin
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied';end if;
 if r.host_id is distinct from auth.uid() then raise exception 'Only the host can import screenshots';end if;
 if r.version is distinct from expected_version then raise exception 'Conflict: room updated. Review the screenshot again.';end if;
 if r.state->>'phase'<>'live' then raise exception 'Start the draft before importing a screenshot';end if;
 if additions is null or jsonb_typeof(additions) is distinct from 'object' or octet_length(additions::text)>10000 then raise exception 'Invalid screenshot additions';end if;
 if jsonb_typeof(additions->'picks') is distinct from 'object' or jsonb_typeof(additions->'bans') is distinct from 'object' then raise exception 'Invalid screenshot additions';end if;
 base=r.state||'{"openDraft":true,"draftStep":0,"draftHistory":[]}'::jsonb;s=base;
 foreach team in array array['ally','enemy'] loop
  if jsonb_typeof(additions->'picks'->team) is distinct from 'array' or jsonb_array_length(additions->'picks'->team)>5
   or jsonb_typeof(additions->'bans'->team) is distinct from 'array' or jsonb_array_length(additions->'bans'->team)>5 then raise exception 'Invalid screenshot additions';end if;
  for item in select value from jsonb_array_elements(additions->'picks'->team) loop
   role=item->>'role';champ=item->>'championId';
   if jsonb_typeof(item) is distinct from 'object' or coalesce(role,'') not in ('Top','Jungle','Mid','ADC','Support') or jsonb_typeof(item->'championId') is distinct from 'string' or champ!~'^[0-9]{1,5}$' then raise exception 'Invalid screenshot pick';end if;
   if exists(select 1 from jsonb_array_elements(s->'picks'->team) p where p->>'role'=role) then
    if exists(select 1 from jsonb_array_elements(s->'picks'->team) p where p->>'role'=role and p->>'championId'=champ) then continue;end if;
    raise exception 'An existing role cannot be overwritten';
   end if;
   s=jsonb_set(s,array['picks',team],(s->'picks'->team)||jsonb_build_array(jsonb_build_object('role',role,'championId',champ)));n=n+1;
  end loop;
  for item in select value from jsonb_array_elements(additions->'bans'->team) loop
   if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'slot') is distinct from 'number' or (item->>'slot')::numeric<>trunc((item->>'slot')::numeric) or (item->>'slot')::numeric not between 0 and 4
    or jsonb_typeof(item->'championId') is distinct from 'string' or coalesce(item->>'championId','')!~'^[0-9]{1,5}$' then raise exception 'Invalid screenshot ban';end if;
   slot=(item->>'slot')::integer;champ=item->>'championId';
   if s->'bans'->team->slot<>'null'::jsonb then
    if s->'bans'->team->>slot=champ then continue;end if;raise exception 'An existing ban cannot be overwritten';
   end if;
   s=jsonb_set(s,array['bans',team,slot::text],to_jsonb(champ));n=n+1;
  end loop;
 end loop;
 if n=0 then raise exception 'No new picks or bans to import';end if;
 select jsonb_agg(value order by ord) into item from jsonb_array_elements(jsonb_build_array('Screenshot imported')||coalesce(s->'history','[]')) with ordinality x(value,ord) where ord<=25;
 s=jsonb_set(s,'{history}',item);perform public.validate_draft(s);
 select * into h from public.draft_timelines where draft_timelines.room_id=r.id for update;
 if not coalesce((r.state->>'openDraft')::boolean,false) then h.undo='[]';end if;
 h.undo=public.draft_stack_push(h.undo,public.draft_position(base));h.redo='[]';
 update public.draft_timelines set undo=h.undo,redo=h.redo,restoring=true where draft_timelines.room_id=r.id;
 -- The ordinary mode guard requires an unchanged checkpoint when opening.
 -- Both updates are invisible until commit; clients receive the final version.
 if not coalesce((r.state->>'openDraft')::boolean,false) then update public.rooms set state=base where id=r.id;end if;
 delete from public.role_swap_requests q where q.room_id=r.id;delete from public.pick_swap_requests q where q.room_id=r.id;
 update public.rooms set state=s,version=version+1 where id=r.id returning * into r;
 update public.draft_timelines set restoring=false where draft_timelines.room_id=r.id;
 return to_jsonb(r);
end $$;
revoke all on function public.import_draft_screenshot(uuid,integer,jsonb) from public,anon;
grant execute on function public.import_draft_screenshot(uuid,integer,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
