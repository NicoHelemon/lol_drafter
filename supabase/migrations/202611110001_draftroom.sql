-- Run as the database owner in a fresh Supabase project. Anonymous Auth must be enabled.
create table public.rooms (
 id uuid primary key default gen_random_uuid(),
 host_id uuid not null references auth.users(id),
 version integer not null default 0,
 state jsonb not null,
 created_at timestamptz not null default now()
);
create table public.room_members (
 room_id uuid references public.rooms(id) on delete cascade,
 user_id uuid references auth.users(id) on delete cascade,
 last_seen timestamptz not null default now(),
 primary key(room_id,user_id)
);
create table public.room_invites (
 room_id uuid primary key references public.rooms(id) on delete cascade,
 token_hash text not null
);
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_invites enable row level security;
create function public.is_room_member(rid uuid) returns boolean language sql stable security definer set search_path = public
as $$select exists(select 1 from public.room_members where room_id=rid and user_id=auth.uid())$$;
create policy members_read_rooms on public.rooms for select to authenticated using(public.is_room_member(id));
create policy members_read_members on public.room_members for select to authenticated using(public.is_room_member(room_id));
grant select on public.rooms,public.room_members to authenticated;
revoke all on public.room_invites from anon,authenticated;
revoke insert,update,delete on public.rooms,public.room_members from anon,authenticated;

create function public.validate_draft(s jsonb) returns void language plpgsql set search_path = public as $$
declare t text; p jsonb; q jsonb; c text; seen text[]='{}'; seats text[]='{}'; ids text[]='{}'; roles text[]; ds jsonb;
begin
 if jsonb_typeof(s)<>'object' or coalesce(s->>'phase','') not in ('setup','live','finished') or coalesce(s->>'side','') not in ('blue','red') then raise exception 'État invalide'; end if;
 if jsonb_typeof(s->'players') is distinct from 'array' or jsonb_array_length(s->'players') not between 1 and 5 then raise exception 'Cinq participants maximum'; end if;
 for p in select value from jsonb_array_elements(s->'players') loop
  if coalesce(p->>'id','')='' or p->>'id'=any(ids) then raise exception 'Identité invalide'; end if;ids=array_append(ids,p->>'id');
  if coalesce(p->>'name','')='' or length(p->>'name')>32 or jsonb_typeof(p->'ready') is distinct from 'boolean' then raise exception 'Participant invalide'; end if;
  if p->>'role' is not null then
   if p->>'role' not in ('Top','Jungle','Mid','ADC','Support') or p->>'role'=any(seats) then raise exception 'Siège déjà réservé ou invalide';end if;
   seats=array_append(seats,p->>'role');
  end if;
  if jsonb_typeof(p->'pool') is distinct from 'array' then raise exception 'Pool invalide';end if;
  if exists(select 1 from jsonb_array_elements(p->'pool') x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^[0-9]{1,5}$') or (select count(*)<>count(distinct value) from jsonb_array_elements(p->'pool')) then raise exception 'Pool invalide';end if;
  if (p->>'ready')::boolean and (p->>'role' is null or jsonb_array_length(p->'pool')=0) then raise exception 'Un pool et un poste sont requis';end if;
 end loop;
 foreach t in array array['ally','enemy'] loop
  if jsonb_typeof(s->'picks'->t) is distinct from 'array' or jsonb_array_length(s->'picks'->t)>5 or jsonb_typeof(s->'bans'->t) is distinct from 'array' or jsonb_array_length(s->'bans'->t)<>5 then raise exception 'Maximum cinq picks et cinq bans par équipe';end if;
  roles='{}';
  for p in select value from jsonb_array_elements(s->'picks'->t) loop
   c=p->>'championId';if c is null or c !~ '^[0-9]{1,5}$' or c=any(seen) then raise exception 'Champion déjà utilisé ou invalide';end if;seen=array_append(seen,c);
   if p->>'role' is not null then
    if p->>'role' not in ('Top','Jungle','Mid','ADC','Support') or p->>'role'=any(roles) then raise exception 'Poste occupé ou invalide';end if;roles=array_append(roles,p->>'role');
   end if;
  end loop;
  for q in select value from jsonb_array_elements(s->'bans'->t) loop
   if q='null'::jsonb then continue;end if;c=q#>>'{}';
   if jsonb_typeof(q)<>'string' or c !~ '^[0-9]{1,5}$' or c=any(seen) then raise exception 'Champion déjà utilisé ou invalide';end if;seen=array_append(seen,c);
  end loop;
 end loop;
 if jsonb_typeof(s->'history') is distinct from 'array' or jsonb_array_length(s->'history')>25 then raise exception 'Historique invalide';end if;
 ds=s->'dataset';
 if jsonb_typeof(ds) is distinct from 'object' or jsonb_typeof(ds->'pairs') is distinct from 'array' or jsonb_array_length(ds->'pairs')>100000 then raise exception 'Dataset invalide';end if;
 foreach t in array array['id','patch','tier','source','importedAt'] loop
  if jsonb_typeof(ds->t) is distinct from 'string' or length(ds->>t)=0 then raise exception 'Métadonnées manquantes';end if;
 end loop;
 if jsonb_typeof(ds->'fictional') is distinct from 'boolean' then raise exception 'Provenance requise';end if;
 perform (ds->>'importedAt')::timestamptz;
 for p in select value from jsonb_array_elements(ds->'pairs') loop
  if coalesce(p->>'relation','') not in ('vs','with') or coalesce(p->>'candidateRole','') not in ('Top','Jungle','Mid','ADC','Support') or coalesce(p->>'otherRole','') not in ('Top','Jungle','Mid','ADC','Support') or coalesce(p->>'candidateChampionId','') !~ '^[0-9]{1,5}$' or coalesce(p->>'otherChampionId','') !~ '^[0-9]{1,5}$' then raise exception 'Paire invalide';end if;
  if p->'delta2' is null or (p->'delta2'<>'null'::jsonb and (jsonb_typeof(p->'delta2')<>'number' or abs((p->>'delta2')::numeric)>100)) then raise exception 'Delta 2 invalide';end if;
  if p->>'relation'='with' and p->>'candidateRole'=p->>'otherRole' then raise exception 'Synergie sur même poste';end if;
  if p ? 'games' and (jsonb_typeof(p->'games')<>'number' or (p->>'games')::numeric<0 or (p->>'games')::numeric<>trunc((p->>'games')::numeric)) then raise exception 'Games invalide';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(ds->'pairs') pair_row group by pair_row->>'relation',pair_row->>'candidateChampionId',pair_row->>'candidateRole',pair_row->>'otherChampionId',pair_row->>'otherRole' having count(*)>1) then raise exception 'Paire dupliquée';end if;
end $$;

create function public.create_room(initial_state jsonb,invite_token text) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
 if auth.uid() is null then raise exception 'Authentification requise';end if;
 if length(invite_token)<64 or length(invite_token)>128 then raise exception 'Invitation invalide';end if;
 perform public.validate_draft(initial_state);
 if jsonb_array_length(initial_state->'players')<>1 or initial_state->'players'->0->>'id'<>auth.uid()::text or initial_state->>'phase'<>'setup' then raise exception 'Créateur invalide';end if;
 insert into public.rooms(host_id,state) values(auth.uid(),initial_state) returning * into r;
 insert into public.room_members(room_id,user_id) values(r.id,auth.uid());
 insert into public.room_invites values(r.id,encode(sha256(convert_to(invite_token,'UTF8')),'hex'));
 return to_jsonb(r);
end $$;
create function public.join_room(room_id uuid,invite_token text,nickname text) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.rooms; s jsonb;
begin
 if auth.uid() is null then raise exception 'Authentification requise';end if;
 select * into r from public.rooms where id=room_id for update;
 if not found then raise exception 'Invitation invalide';end if;
 if public.is_room_member(room_id) then update public.room_members set last_seen=now() where room_members.room_id=join_room.room_id and user_id=auth.uid();return to_jsonb(r);end if;
 if not exists(select 1 from public.room_invites i where i.room_id=join_room.room_id and i.token_hash=encode(sha256(convert_to(invite_token,'UTF8')),'hex')) then raise exception 'Invitation invalide';end if;
 if r.state->>'phase'<>'setup' then raise exception 'Draft déjà démarrée';end if;
 if jsonb_array_length(r.state->'players')>=5 then raise exception 'Salle complète';end if;
 if length(trim(nickname)) not between 1 and 32 then raise exception 'Pseudonyme invalide';end if;
 s=jsonb_set(r.state,'{players}',(r.state->'players')||jsonb_build_array(jsonb_build_object('id',auth.uid(),'name',trim(nickname),'role',null,'pool','[]'::jsonb,'ready',false)));
 insert into public.room_members(room_id,user_id) values(r.id,auth.uid());
 update public.rooms set state=s,version=version+1 where id=r.id returning * into r;return to_jsonb(r);
end $$;
create function public.save_room(room_id uuid,expected_version integer,next_state jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
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
  if not is_host and (p->>'id'<>auth.uid()::text or r.state->>'phase'<>'setup') and p is distinct from oldp then raise exception 'Pool/siège non modifiable';end if;
  if r.state->>'phase'<>'setup' and p->'role' is distinct from oldp->'role' then raise exception 'Siège figé';end if;
 end loop;
 if next_state->>'phase'='live' and r.state->>'phase'<>'live' then
  if r.state->>'phase'<>'setup' or exists(select 1 from jsonb_array_elements(next_state->'players') x where not (x->>'ready')::boolean) then raise exception 'Préparation requise';end if;
 end if;
 if r.state->>'phase'='setup' and next_state->>'phase'='finished' then raise exception 'Démarrer la draft avant de terminer';end if;
 update public.rooms set state=next_state,version=version+1 where id=room_id returning * into r;return to_jsonb(r);
end $$;
create function public.heartbeat(room_id uuid) returns void language sql security definer set search_path = public as $$
 update public.room_members set last_seen=now() where room_members.room_id=heartbeat.room_id and user_id=auth.uid()
$$;
revoke execute on function public.validate_draft(jsonb) from public;
revoke execute on function public.is_room_member(uuid),public.create_room(jsonb,text),public.join_room(uuid,text,text),public.save_room(uuid,integer,jsonb),public.heartbeat(uuid) from public;
grant execute on function public.is_room_member(uuid),public.create_room(jsonb,text),public.join_room(uuid,text,text),public.save_room(uuid,integer,jsonb),public.heartbeat(uuid) to authenticated;
-- Supabase creates this publication. The conditional also supports local SQL tests.
do $$begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.rooms;end if;end$$;
