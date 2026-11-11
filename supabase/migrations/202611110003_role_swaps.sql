-- Apply after the room lifecycle migration. No existing pools or roles are reset.
begin;
create table if not exists public.role_swap_requests (
 id uuid primary key default gen_random_uuid(),
 room_id uuid not null references public.rooms(id) on delete cascade,
 requester_id uuid not null references auth.users(id) on delete cascade,
 target_id uuid not null references auth.users(id) on delete cascade,
 from_role text not null check(from_role in ('Top','Jungle','Mid','ADC','Support')),
 to_role text not null check(to_role in ('Top','Jungle','Mid','ADC','Support')),
 created_at timestamptz not null default now(),
 check(requester_id<>target_id),check(from_role<>to_role)
);
create index if not exists role_swap_room_idx on public.role_swap_requests(room_id);
alter table public.role_swap_requests enable row level security;
drop policy if exists room_members_read_swaps on public.role_swap_requests;
create policy room_members_read_swaps on public.role_swap_requests for select to authenticated using(public.is_room_member(room_id));
revoke all on public.role_swap_requests from anon,authenticated;
grant select on public.role_swap_requests to authenticated;

create or replace function public.guard_role_swaps() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.state->>'phase'='setup' and new.state->>'phase'='live' and exists(select 1 from public.role_swap_requests where room_id=new.id) then raise exception 'Resolve pending role swaps before starting';end if;
 return new;
end $$;
create or replace function public.clean_role_swaps() returns trigger language plpgsql security definer set search_path=public as $$
begin
 delete from public.role_swap_requests r where r.room_id=new.id and (
 new.state->>'phase'<>'setup' or
 not exists(select 1 from jsonb_array_elements(new.state->'players') p where p->>'id'=r.requester_id::text and p->>'role'=r.from_role) or
 not exists(select 1 from jsonb_array_elements(new.state->'players') p where p->>'id'=r.target_id::text and p->>'role'=r.to_role));
 return new;
end $$;
drop trigger if exists guard_role_swaps on public.rooms;
create trigger guard_role_swaps before update on public.rooms for each row execute function public.guard_role_swaps();
drop trigger if exists clean_role_swaps on public.rooms;
create trigger clean_role_swaps after update on public.rooms for each row execute function public.clean_role_swaps();

create or replace function public.request_role_swap(room_id uuid, target_id uuid, expected_version integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; mine text; theirs text;
begin
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied';end if;
 if r.version is distinct from expected_version then raise exception 'Conflict: room updated. Please try again.';end if;
 if r.state->>'phase'<>'setup' then raise exception 'Role swaps are only available during preparation';end if;
 select p->>'role' into mine from jsonb_array_elements(r.state->'players') p where p->>'id'=auth.uid()::text;
 select p->>'role' into theirs from jsonb_array_elements(r.state->'players') p where p->>'id'=request_role_swap.target_id::text;
 if mine is null or theirs is null or auth.uid()=target_id or mine=theirs then raise exception 'Both players must have different roles';end if;
 if exists(select 1 from public.role_swap_requests s where s.room_id=r.id and (s.requester_id in (auth.uid(),request_role_swap.target_id) or s.target_id in (auth.uid(),request_role_swap.target_id))) then raise exception 'A role swap is already pending for one of these players';end if;
 insert into public.role_swap_requests(room_id,requester_id,target_id,from_role,to_role) values(r.id,auth.uid(),request_role_swap.target_id,mine,theirs);
 update public.rooms set version=version+1 where id=r.id returning * into r;
 return to_jsonb(r);
end $$;
create or replace function public.respond_role_swap(room_id uuid, request_id uuid, accept boolean, expected_version integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; request public.role_swap_requests; s jsonb;
begin
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied';end if;
 if r.version is distinct from expected_version then raise exception 'Conflict: room updated. Please try again.';end if;
 select * into request from public.role_swap_requests where id=request_id and role_swap_requests.room_id=r.id;
 if not found then raise exception 'This role swap is no longer available';end if;
 if accept is null then raise exception 'Choose accept or decline';end if;
 if (accept and auth.uid()<>request.target_id) or (not accept and auth.uid() not in (request.requester_id,request.target_id)) then raise exception 'Only the requested player can accept a role swap';end if;
 if accept then
  if r.state->>'phase'<>'setup' then raise exception 'Role swaps are only available during preparation';end if;
  if not exists(select 1 from jsonb_array_elements(r.state->'players') p where p->>'id'=request.requester_id::text and p->>'role'=request.from_role) or not exists(select 1 from jsonb_array_elements(r.state->'players') p where p->>'id'=request.target_id::text and p->>'role'=request.to_role) then raise exception 'The requested roles have changed';end if;
  select jsonb_set(r.state,'{players}',jsonb_agg(case
   when p->>'id'=request.requester_id::text then jsonb_set(jsonb_set(p,'{role}',to_jsonb(request.to_role)),'{ready}','false'::jsonb)
   when p->>'id'=request.target_id::text then jsonb_set(jsonb_set(p,'{role}',to_jsonb(request.from_role)),'{ready}','false'::jsonb)
   else p end order by position)) into s from jsonb_array_elements(r.state->'players') with ordinality as player(p,position);
  perform public.validate_draft(s);
 else s=r.state;
 end if;
 delete from public.role_swap_requests where id=request.id;
 update public.rooms set state=s,version=version+1 where id=r.id returning * into r;
 return to_jsonb(r);
end $$;
revoke execute on function public.guard_role_swaps(),public.clean_role_swaps(),public.request_role_swap(uuid,uuid,integer),public.respond_role_swap(uuid,uuid,boolean,integer) from public;
grant execute on function public.request_role_swap(uuid,uuid,integer),public.respond_role_swap(uuid,uuid,boolean,integer) to authenticated;
create or replace function public.save_room(room_id uuid,expected_version integer,next_state jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.rooms;p jsonb;oldp jsonb;is_host boolean;
begin
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Accès refusé';end if;
 if r.version is distinct from expected_version then raise exception 'Conflit : état actualisé, recommencez votre action';end if;
 if octet_length(next_state::text)>12000000 then raise exception 'État trop volumineux';end if;
 perform public.validate_draft(next_state);is_host=r.host_id=auth.uid();
 if (select array_agg(x->>'id' order by x->>'id') from jsonb_array_elements(next_state->'players') x) is distinct from (select array_agg(x->>'id' order by x->>'id') from jsonb_array_elements(r.state->'players') x) then raise exception 'Participants immuables';end if;
 if (not is_host or r.state->>'phase'<>'setup') and next_state->'dataset' is distinct from r.state->'dataset' then raise exception 'Dataset figé ou réservé à l’hôte';end if;
 if not is_host and (next_state->'phase' is distinct from r.state->'phase' or next_state->'side' is distinct from r.state->'side') then raise exception 'Action réservée à l’hôte';end if;
 if r.state->>'phase'='finished' and (next_state->'picks' is distinct from r.state->'picks' or next_state->'bans' is distinct from r.state->'bans') and not (is_host and next_state->>'phase'='setup') then raise exception 'Draft terminée';end if;
 for p in select value from jsonb_array_elements(next_state->'players') loop
  select value into oldp from jsonb_array_elements(r.state->'players') where value->>'id'=p->>'id';
  if p->>'id'<>auth.uid()::text and p->'role' is distinct from oldp->'role' then raise exception 'Only a player can change their own role; request a swap';end if;
  if not is_host and (p->>'id'<>auth.uid()::text or r.state->>'phase'<>'setup') and p is distinct from oldp then raise exception 'Pool/siège non modifiable';end if;
  if r.state->>'phase'<>'setup' and p->'role' is distinct from oldp->'role' then raise exception 'Siège figé';end if;
 end loop;
 if next_state->>'phase'='live' and r.state->>'phase'<>'live' then
  if r.state->>'phase'<>'setup' or exists(select 1 from jsonb_array_elements(next_state->'players') x where not (x->>'ready')::boolean) then raise exception 'Préparation requise';end if;
 end if;
 if r.state->>'phase'='setup' and next_state->>'phase'='finished' then raise exception 'Démarrer la draft avant de terminer';end if;
 update public.rooms set state=next_state,version=version+1 where id=room_id returning * into r;return to_jsonb(r);
end $$;

commit;
