-- Optional verified-email profiles, ten participants, derived spectators and host transfer.
begin;
drop trigger guard_participant_types on public.rooms;
drop function public.guard_participant_types();
create table public.user_profiles(
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check(length(trim(display_name)) between 1 and 32),
 role_pools jsonb not null default '{}',version integer not null default 1 check(version>0),updated_at timestamptz not null default now()
);
alter table public.user_profiles enable row level security;
create function public.is_registered_account() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from auth.users u where u.id=auth.uid() and not coalesce(u.is_anonymous,true) and u.email_confirmed_at is not null)
$$;
revoke all on function public.is_registered_account() from public,anon,authenticated;
grant execute on function public.is_registered_account() to authenticated;
create policy own_profile_read on public.user_profiles for select to authenticated using(user_id=auth.uid() and public.is_registered_account());
revoke all on public.user_profiles from public,anon,authenticated;
grant select on public.user_profiles to authenticated;
create table public.account_features(singleton boolean primary key default true check(singleton),email_login_ready boolean not null default false);
insert into public.account_features(singleton) values(true);
alter table public.account_features enable row level security;
create policy read_account_features on public.account_features for select to anon,authenticated using(true);
revoke all on public.account_features from public,anon,authenticated;
grant select on public.account_features to anon,authenticated;
create function public.account_login_allowed() returns boolean language sql stable security definer set search_path=public as $$
 select auth.uid() is not null and not exists(select 1 from public.room_members m where m.user_id=auth.uid())
$$;
revoke all on function public.account_login_allowed() from public,anon,authenticated;
grant execute on function public.account_login_allowed() to authenticated;
create function public.save_my_profile(new_name text,new_pools jsonb,expected_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.user_profiles;entry record;
begin
 if not public.is_registered_account() then raise exception 'Sign in with a verified email before saving a profile';end if;
 if new_name is null or length(trim(new_name)) not between 1 and 32 then raise exception 'Choose a display name between 1 and 32 characters';end if;
 if jsonb_typeof(new_pools) is distinct from 'object' or exists(select 1 from jsonb_object_keys(new_pools) key where key not in ('Top','Jungle','Mid','ADC','Support')) then raise exception 'Invalid personal role pools';end if;
 for entry in select * from jsonb_each(new_pools) loop perform public.validate_role_pool(entry.value);end loop;
 select * into p from public.user_profiles where user_id=auth.uid() for update;
 if found then
  if p.version is distinct from expected_version then raise exception 'Conflict: profile updated. Reload your profile and try again.';end if;
  update public.user_profiles set display_name=trim(new_name),role_pools=new_pools,version=version+1,updated_at=now() where user_id=auth.uid() returning * into p;
 else
  if expected_version is distinct from 0 then raise exception 'Conflict: profile updated. Reload your profile and try again.';end if;
  begin insert into public.user_profiles(user_id,display_name,role_pools) values(auth.uid(),trim(new_name),new_pools) returning * into p;
  exception when unique_violation then raise exception 'Conflict: profile updated. Reload your profile and try again.';end;
 end if;return to_jsonb(p);
end $$;
revoke all on function public.save_my_profile(text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.save_my_profile(text,jsonb,integer) to authenticated;

-- Only the current role's preferences are copied into the room, never the whole profile.
create function public.apply_personal_pools(before_state jsonb,after_state jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare member jsonb;old_role text;preferences jsonb;items jsonb='[]';
begin
 for member in select value from jsonb_array_elements(after_state->'players') loop
  select p->>'role' into old_role from jsonb_array_elements(before_state->'players') p where p->>'id'=member->>'id';
  if member->>'role' is not null and member->>'role' is distinct from old_role then
   select profile.role_pools into preferences from public.user_profiles profile join auth.users u on u.id=profile.user_id where profile.user_id=(member->>'id')::uuid and not coalesce(u.is_anonymous,true) and u.email_confirmed_at is not null;
   if found then member=jsonb_set(member,'{pool}',coalesce(preferences->(member->>'role'),'[]'));end if;
  end if;
  items=items||jsonb_build_array(member);
 end loop;
 return jsonb_set(after_state,'{players}',items);
end $$;
create function public.load_personal_pools() returns trigger language plpgsql security definer set search_path=public as $$
begin new.state=public.apply_personal_pools(old.state,new.state);return new;end $$;
create trigger aaa_load_personal_pools before update of state on public.rooms for each row execute function public.load_personal_pools();
revoke all on function public.apply_personal_pools(jsonb,jsonb),public.load_personal_pools() from public,anon,authenticated;
create or replace function public.validate_draft(s jsonb) returns void language plpgsql set search_path=public as $$
declare t text;p jsonb;c text;seen text[]='{}';roles text[];seats text[]='{}';ids text[]='{}';ds jsonb;team_bans text[];
begin
 if coalesce(s->>'phase','') not in ('setup','live') or coalesce(s->>'side','') not in ('blue','red') then raise exception 'Invalid room state';end if;
 if jsonb_typeof(s->'players') is distinct from 'array' or jsonb_array_length(s->'players') not between 1 and 10 then raise exception 'Up to ten participants allowed';end if;
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
create or replace function public.exchange_live_roles(s jsonb,from_role text,to_role text) returns jsonb
language plpgsql set search_path=public as $$
declare players jsonb;picks jsonb;
begin
 select jsonb_agg(case when p->>'role'=from_role then jsonb_set(p,'{role}',to_jsonb(to_role))
  when p->>'role'=to_role then jsonb_set(p,'{role}',to_jsonb(from_role)) else p end order by pos)
  into players from jsonb_array_elements(s->'players') with ordinality x(p,pos);
 select coalesce(jsonb_agg(case when p->>'role'=from_role then jsonb_set(p,'{role}',to_jsonb(to_role))
  when p->>'role'=to_role then jsonb_set(p,'{role}',to_jsonb(from_role)) else p end order by pos),'[]'::jsonb)
  into picks from jsonb_array_elements(s->'picks'->'ally') with ordinality x(p,pos);
 return public.apply_personal_pools(s,jsonb_set(jsonb_set(s,'{players}',players),'{picks,ally}',picks));
end $$;
create or replace function public.guard_live_roles() returns trigger language plpgsql security definer set search_path=public as $$
declare p jsonb;before_role text;after_role text;changed_id text;expected jsonb;
begin
 if old.state->>'phase'<>'live' then return new;end if;
 for p in select value from jsonb_array_elements(new.state->'players') loop
  select x->>'role' into before_role from jsonb_array_elements(old.state->'players') x where x->>'id'=p->>'id';
  if p->>'role' is distinct from before_role then changed_id=p->>'id';after_role=p->>'role';exit;end if;
 end loop;
 if changed_id is null then return new;end if;
 if before_role is null or after_role is null then
  if changed_id is distinct from auth.uid()::text or after_role is not null and exists(select 1 from jsonb_array_elements(old.state->'players') item where item->>'role'=after_role) then raise exception 'Only claim a free role or release your own role';end if;
  select jsonb_set(old.state,'{players}',jsonb_agg(case when item->>'id'=changed_id then jsonb_set(item,'{role}',coalesce(to_jsonb(after_role),'null')) else item end order by pos)) into expected from jsonb_array_elements(old.state->'players') with ordinality a(item,pos);
  expected=public.apply_personal_pools(old.state,expected);
  if new.state->'players' is distinct from expected->'players' or new.state->'picks' is distinct from old.state->'picks' or new.state->'dataset' is distinct from old.state->'dataset' then raise exception 'Claiming a role must preserve the draft';end if;
  return new;
 end if;
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
create or replace function public.assert_room_editor(rid uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_room_member(rid) then raise exception 'Access denied';end if;
 if not exists(select 1 from public.rooms r where r.id=rid and (r.host_id=auth.uid() or exists(select 1 from jsonb_array_elements(r.state->'players') p where p->>'id'=auth.uid()::text and p->>'role' is not null))) then raise exception 'Take a role to edit the draft, or ask the host';end if;
end $$;
create or replace function public.leave_room(room_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare r public.rooms;remaining jsonb;next_host uuid;
begin
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied';end if;
 select coalesce(jsonb_agg(value order by position),'[]'::jsonb) into remaining from jsonb_array_elements(r.state->'players') with ordinality as player(value,position) where value->>'id'<>auth.uid()::text;
 if jsonb_array_length(remaining)=0 then delete from public.rooms where id=r.id;return;end if;
 next_host=case when r.host_id=auth.uid() then (select (p->>'id')::uuid from jsonb_array_elements(remaining) with ordinality x(p,pos) order by (p->>'role' is null),pos limit 1) else r.host_id end;
 update public.rooms set host_id=next_host,version=version+1,state=jsonb_set(r.state,'{players}',remaining) where id=r.id;
 delete from public.room_members where room_members.room_id=r.id and user_id=auth.uid();
end $$;
create or replace function public.draft_assignments(s jsonb) returns jsonb language sql immutable set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_array(p->>'id',p->>'role') order by p->>'id'),'[]'::jsonb) from jsonb_array_elements(s->'players') p where p->>'role' is not null
$$;
drop function public.join_room(text,text,text,boolean);
create function public.join_room(room_slug text,invite_token text,nickname text) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms;s jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select * into r from public.rooms where slug=room_slug for update;
 if not found then raise exception 'Room not found';end if;
 if public.is_room_member(r.id) then return to_jsonb(r);end if;
 if not exists(select 1 from public.room_invites i where i.room_id=r.id and i.token_hash=encode(sha256(convert_to(invite_token,'UTF8')),'hex')) then raise exception 'Invalid invitation';end if;
 if jsonb_array_length(r.state->'players')>=10 then raise exception 'Room is full (10 participants maximum)';end if;
 if nickname is null or length(trim(nickname)) not between 1 and 32 then raise exception 'Invalid display name';end if;
 s=jsonb_set(r.state,'{players}',(r.state->'players')||jsonb_build_array(jsonb_build_object('id',auth.uid(),'name',trim(nickname),'role',null,'pool','[]'::jsonb)));
 perform public.validate_draft(s);insert into public.room_members(room_id,user_id) values(r.id,auth.uid());
 update public.rooms set state=s,version=version+1 where id=r.id returning * into r;return to_jsonb(r);
end $$;
create function public.claim_role(room_id uuid,new_role text,expected_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms;mine text;s jsonb;
begin
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied';end if;
 if r.version is distinct from expected_version then raise exception 'Conflict: room updated. Please try again.';end if;
 if new_role is not null and new_role not in ('Top','Jungle','Mid','ADC','Support') then raise exception 'Invalid role';end if;
 select p->>'role' into mine from jsonb_array_elements(r.state->'players') p where p->>'id'=auth.uid()::text;
 if new_role is not null and exists(select 1 from jsonb_array_elements(r.state->'players') p where p->>'role'=new_role and p->>'id'<>auth.uid()::text) then raise exception 'Role already taken; request a role swap';end if;
 if mine is not null and new_role is not null and mine<>new_role and r.state->>'phase'='live' then return public.move_live_role(r.id,new_role,expected_version);end if;
 select jsonb_set(r.state,'{players}',jsonb_agg(case when p->>'id'=auth.uid()::text then jsonb_set(p,'{role}',coalesce(to_jsonb(new_role),'null')) else p end order by pos)) into s from jsonb_array_elements(r.state->'players') with ordinality x(p,pos);
 s=public.apply_personal_pools(r.state,s);perform public.validate_draft(s);
 update public.rooms set state=s,version=version+1 where id=r.id returning * into r;return to_jsonb(r);
end $$;
create function public.transfer_host(room_id uuid,target_id uuid,expected_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms;
begin
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied';end if;
 if r.host_id<>auth.uid() then raise exception 'Only the host can transfer hosting';end if;
 if r.version is distinct from expected_version then raise exception 'Conflict: room updated. Please try again.';end if;
 if target_id is null or target_id=auth.uid() or not exists(select 1 from public.room_members m where m.room_id=r.id and m.user_id=target_id) then raise exception 'Choose another room participant';end if;
 update public.rooms set host_id=target_id,version=version+1 where id=r.id returning * into r;return to_jsonb(r);
end $$;
revoke all on function public.join_room(text,text,text),public.claim_role(uuid,text,integer),public.transfer_host(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.join_room(text,text,text),public.claim_role(uuid,text,integer),public.transfer_host(uuid,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
