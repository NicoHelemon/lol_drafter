-- Rooms adopt new statistics in preparation, and only on host request during a draft.
-- Existing draft choices and snapshots remain intact; ordinary room expiry still applies.
begin;
create function public.current_statistics_dataset() returns jsonb
language sql security definer set search_path=public as $$
 select s.metadata||jsonb_build_object('pairs','[]'::jsonb)
 from public.statistics_current c
 join public.statistics_snapshots s on s.id=c.snapshot_id and s.ready
 join public.statistics_calibrations m on m.snapshot_id=s.id
 join public.statistics_role_catalogues cat on cat.snapshot_id=s.id
 where c.singleton for share of s
$$;

create function public.adopt_lobby_statistics() returns trigger
language plpgsql security definer set search_path=public as $$
declare ds jsonb;
begin
 if new.state->>'phase'='setup' or (tg_op='UPDATE' and old.state->>'phase'='setup') then
  ds=public.current_statistics_dataset();
  if ds is not null then new.state=jsonb_set(new.state,'{dataset}',ds);end if;
 end if;
 return new;
end $$;
-- Runs before dataset externalization and validation. Also catches returning to
-- preparation and starting a draft while a publication has just completed.
create trigger a_adopt_lobby_statistics before insert or update of state on public.rooms
 for each row execute function public.adopt_lobby_statistics();

create function public.refresh_room_statistics(room_id uuid,expected_version integer default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.rooms;ds jsonb;
begin
 select * into r from public.rooms where id=room_id for update;
 if not found or not public.is_room_member(room_id) then raise exception 'Access denied';end if;
 if r.state->>'phase'='live' then
  -- A lobby poll can race the start of a draft. It must only read the room.
  if expected_version is null then return to_jsonb(r);end if;
  if r.host_id is distinct from auth.uid() then raise exception 'Only the host can update draft data';end if;
 end if;
 if expected_version is not null and r.version is distinct from expected_version then
  raise exception 'Conflict: room updated. Please try again.';
 end if;
 ds=public.current_statistics_dataset();
 if ds is null or r.state->'dataset'=ds then return to_jsonb(r);end if;
 -- Only the dataset changes: picks, bans, roles, pools, mode and Undo/Redo stay.
 update public.rooms set state=jsonb_set(state,'{dataset}',ds),version=version+1
 where id=r.id returning * into r;
 return to_jsonb(r);
end $$;
revoke all on function public.current_statistics_dataset(),public.adopt_lobby_statistics(),public.refresh_room_statistics(uuid,integer) from public,anon,authenticated;
grant execute on function public.refresh_room_statistics(uuid,integer) to authenticated;

-- A retired snapshot remains editable by a draft already using it. It cannot
-- be newly attached after its grace period; lobby rooms always adopt current.
create or replace function public.externalize_room_statistics() returns trigger language plpgsql security definer set search_path=public as $$
declare ds jsonb; sid text; meta jsonb; existing_meta jsonb; is_ready boolean; retired timestamptz;
begin
 ds=new.state->'dataset';
 if ds?'snapshotId' then
  sid=ds->>'snapshotId';
  select metadata,ready,retired_at into meta,is_ready,retired from public.statistics_snapshots where id=sid for share;
  if meta is null or not coalesce(is_ready,false) or ds-'pairs' is distinct from meta or ds->'pairs' is distinct from '[]'::jsonb then
   raise exception 'Invalid shared statistics reference';
  end if;
 else
  perform public.validate_draft(new.state);
  sid=encode(sha256(convert_to(ds::text,'UTF8')),'hex');
  meta=(ds-'pairs')||jsonb_build_object('snapshotId',sid);
  insert into public.statistics_snapshots(id,metadata) values(sid,meta) on conflict do nothing;
  select metadata,ready,retired_at into existing_meta,is_ready,retired from public.statistics_snapshots where id=sid for update;
  if existing_meta is distinct from meta then raise exception 'Snapshot identity collision';end if;
  if not is_ready then
   insert into public.statistics_shards(snapshot_id,candidate_key,pairs)
    select sid,(p->>'candidateChampionId')||':'||(p->>'candidateRole'),jsonb_agg(p)
    from jsonb_array_elements(ds->'pairs') p group by p->>'candidateChampionId',p->>'candidateRole';
   update public.statistics_snapshots set ready=true where id=sid;
  end if;
 end if;
 if retired<=now()-interval '1 hour' and not exists(select 1 from public.statistics_current where snapshot_id=sid)
  and (tg_op='INSERT' or old.state->'dataset'->>'snapshotId' is distinct from sid) then
  raise exception 'Statistics snapshot has expired. Please create a new room.';
 end if;
 new.state=jsonb_set(new.state,'{dataset}',meta||jsonb_build_object('pairs','[]'::jsonb));
 return new;
end $$;


-- Publication no longer expires active rooms. Referenced snapshots survive
-- until the rooms expire by their ordinary age/presence rules.
create or replace function public.maintain_statistics(dry_run boolean default true) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.rooms; s public.statistics_snapshots; room_count integer=0; snapshot_count integer=0;
 shard_count integer=0; retired_count integer=0; n integer; previous_setting text;
begin
 perform pg_advisory_xact_lock(765432100);
 -- Lock snapshots first, but never wait on a publisher or a room edit. Room
 -- edits lock rooms before references; SKIP LOCKED prevents a reverse deadlock.
 for s in select * from public.statistics_snapshots order by id for update skip locked loop
  if exists(select 1 from public.statistics_current where snapshot_id=s.id) then continue;end if;
  if s.ready and s.retired_at is null and not exists(select 1 from public.rooms where state->'dataset'->>'snapshotId'=s.id) then
   retired_count=retired_count+1;
   if not dry_run then update public.statistics_snapshots set retired_at=now() where id=s.id;end if;
  end if;
 end loop;
 for r in select * from public.rooms order by id for update skip locked loop
  if r.created_at<=now()-interval '24 hours'
   or greatest(r.created_at,coalesce((select max(last_seen) from public.room_members where room_id=r.id),r.created_at))<=now()-interval '2 hours' then
   room_count=room_count+1;
   if not dry_run then delete from public.rooms where id=r.id;end if;
  end if;
 end loop;
 previous_setting=current_setting('draftroom.maintenance',true);
 perform set_config('draftroom.maintenance','on',true);
 for s in select * from public.statistics_snapshots order by id for update skip locked loop
  if exists(select 1 from public.statistics_current where snapshot_id=s.id) then continue;end if;
  if ((s.ready and s.retired_at<=now()-interval '1 hour') or (not s.ready and s.created_at<=now()-interval '24 hours'))
   and not exists(select 1 from public.rooms rr where rr.state->'dataset'->>'snapshotId'=s.id and
     (not dry_run or not (rr.created_at<=now()-interval '24 hours'
       or greatest(rr.created_at,coalesce((select max(last_seen) from public.room_members where room_id=rr.id),rr.created_at))<=now()-interval '2 hours'))) then
   snapshot_count=snapshot_count+1;
   select count(*) into n from public.statistics_shards where snapshot_id=s.id;
   shard_count=shard_count+n;
   if not dry_run then
    delete from public.statistics_shards where snapshot_id=s.id;
    delete from public.statistics_snapshots where id=s.id;
   end if;
  end if;
 end loop;
 perform set_config('draftroom.maintenance',coalesce(previous_setting,''),true);
 return jsonb_build_object('dryRun',dry_run,'rooms',room_count,'snapshots',snapshot_count,'shards',shard_count,'retired',retired_count);
end $$;


notify pgrst,'reload schema';
commit;
