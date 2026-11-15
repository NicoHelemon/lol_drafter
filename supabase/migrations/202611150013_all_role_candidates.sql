-- Shared candidates for unoccupied ally seats and all opponent seats.
-- Personal pools remain authoritative for occupied ally seats. No data reset.
begin;
create function public.validate_role_pool(pool jsonb) returns void language plpgsql set search_path=public as $$
begin
 if jsonb_typeof(pool) is distinct from 'array' then raise exception 'Invalid candidate pool';end if;
 if jsonb_array_length(pool)>500 or exists(select 1 from jsonb_array_elements(pool) c where jsonb_typeof(c)<>'string' or c#>>'{}' !~ '^[0-9]{1,5}$')
  or (select count(*)<>count(distinct value) from jsonb_array_elements(pool)) then raise exception 'Invalid candidate pool';end if;
end $$;
create function public.validate_role_pools(pools jsonb) returns void language plpgsql set search_path=public as $$
declare t record;r record;
begin
 if pools is null then return;end if;
 if jsonb_typeof(pools) is distinct from 'object' then raise exception 'Invalid role pools';end if;
 for t in select * from jsonb_each(pools) loop
  if t.key not in ('ally','enemy') or jsonb_typeof(t.value)<>'object' then raise exception 'Invalid role pools';end if;
  for r in select * from jsonb_each(t.value) loop
   if r.key not in ('Top','Jungle','Mid','ADC','Support') then raise exception 'Invalid role pools';end if;
   perform public.validate_role_pool(r.value);
  end loop;
 end loop;
end $$;
create function public.reconcile_role_pools() returns trigger language plpgsql set search_path=public as $$
declare pools jsonb;p jsonb;
begin
 perform public.validate_role_pools(new.state->'rolePools');
 pools=new.state->'rolePools';
 if tg_op='UPDATE' then
  pools=coalesce(pools,old.state->'rolePools');
  for p in select value from jsonb_array_elements(old.state->'players') loop
   if p->>'role' is not null and not exists(select 1 from jsonb_array_elements(new.state->'players') n where n->>'role'=p->>'role') then
    pools=coalesce(pools,'{}'::jsonb);pools=jsonb_set(pools,'{ally}',coalesce(pools->'ally','{}'::jsonb));
    pools=jsonb_set(pools,array['ally',p->>'role'],p->'pool');
   end if;
  end loop;
 end if;
 if pools is not null then
  for p in select value from jsonb_array_elements(new.state->'players') loop
   if p->>'role' is not null then pools=pools#-array['ally',p->>'role'];end if;
  end loop;
  new.state=jsonb_set(new.state,'{rolePools}',pools);
 end if;
 return new;
end $$;
create trigger reconcile_role_pools before insert or update of state on public.rooms for each row execute function public.reconcile_role_pools();

create function public.set_role_candidates(room_id uuid,team text,role text,champion_ids jsonb,expected_version integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.rooms;s jsonb;p jsonb;pools jsonb;
begin
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
revoke all on function public.validate_role_pool(jsonb),public.validate_role_pools(jsonb),public.reconcile_role_pools() from public,anon,authenticated;
revoke all on function public.set_role_candidates(uuid,text,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.set_role_candidates(uuid,text,text,jsonb,integer) to authenticated;
notify pgrst,'reload schema';
commit;
