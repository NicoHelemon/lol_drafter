-- Install only after 007. Installation never deletes rooms or statistical data.
-- maintain_statistics() previews by default; execution is restricted to the owner.
begin;
alter table public.statistics_snapshots add column retired_at timestamptz;
create index rooms_statistics_snapshot on public.rooms ((state->'dataset'->>'snapshotId'));
create index room_members_presence on public.room_members (room_id,last_seen);
create index snapshots_retirement on public.statistics_snapshots (retired_at);

-- Only the lifecycle timestamp may change on a ready snapshot. The deletion
-- exception is local to owner maintenance, and still checks pointers/references.
create or replace function public.protect_ready_statistics() returns trigger language plpgsql set search_path=public as $$
declare sid text; can_purge boolean;
begin
 if tg_table_name='statistics_snapshots' then
  sid=old.id;
  if tg_op='UPDATE' and old.ready and (to_jsonb(new)-'retired_at')=(to_jsonb(old)-'retired_at') then return new;end if;
 else
  sid=case when tg_op='INSERT' then new.snapshot_id else old.snapshot_id end;
 end if;
 can_purge=tg_op='DELETE'
  and current_setting('draftroom.maintenance',true)='on'
  and current_user=pg_get_userbyid((select relowner from pg_class where oid='public.statistics_snapshots'::regclass))
  and not exists(select 1 from public.statistics_current where snapshot_id=sid)
  and not exists(select 1 from public.rooms where state->'dataset'->>'snapshotId'=sid)
  and exists(select 1 from public.statistics_snapshots where id=sid and
   ((ready and retired_at<=now()-interval '1 hour') or (not ready and created_at<=now()-interval '24 hours')));
 if tg_table_name='statistics_snapshots' then
  if old.ready and not coalesce(can_purge,false) then raise exception 'Ready snapshots are immutable';end if;
 else
  if not coalesce(can_purge,false) and (exists(select 1 from public.statistics_snapshots where id=sid and ready)
   or (tg_op='UPDATE' and exists(select 1 from public.statistics_snapshots where id=new.snapshot_id and ready))) then
   raise exception 'Ready snapshots are immutable';
  end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;

-- Share locks held through commit prevent purge racing a new room reference.
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
 if retired<=now()-interval '1 hour' and not exists(select 1 from public.statistics_current where snapshot_id=sid) then
  raise exception 'Statistics snapshot has expired. Please create a new room.';
 end if;
 new.state=jsonb_set(new.state,'{dataset}',meta||jsonb_build_object('pairs','[]'::jsonb));
 return new;
end $$;

-- Serialize pointer changes and maintenance. Publishers acquire this lock before
-- locking their candidate snapshot too. Failed promotions roll retirement back.
create function public.retire_statistics_pointer() returns trigger language plpgsql set search_path=public as $$
begin
 perform pg_advisory_xact_lock(765432100);
 if not exists(select 1 from public.statistics_snapshots where id=new.snapshot_id and ready and metadata->>'fictional'='false') then
  raise exception 'Current snapshot must be ready and real';
 end if;
 if tg_op='UPDATE' and old.snapshot_id<>new.snapshot_id then
  update public.statistics_snapshots set retired_at=now() where id=old.snapshot_id;
 end if;
 update public.statistics_snapshots set retired_at=null where id=new.snapshot_id and retired_at is not null;
 return new;
end $$;
revoke all on function public.retire_statistics_pointer() from public,anon,authenticated;
create trigger retire_statistics_pointer before insert or update on public.statistics_current
 for each row execute function public.retire_statistics_pointer();

-- Existing noncurrent snapshots start a fresh transition period at installation.
update public.statistics_snapshots set retired_at=now() where ready
 and not exists(select 1 from public.statistics_current where snapshot_id=id);

create function public.maintain_statistics(dry_run boolean default true) returns jsonb
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
   or greatest(r.created_at,coalesce((select max(last_seen) from public.room_members where room_id=r.id),r.created_at))<=now()-interval '2 hours'
   or exists(select 1 from public.statistics_snapshots ss where ss.id=r.state->'dataset'->>'snapshotId'
     and ss.retired_at<=now()-interval '1 hour' and not exists(select 1 from public.statistics_current c where c.snapshot_id=ss.id)) then
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
       or greatest(rr.created_at,coalesce((select max(last_seen) from public.room_members where room_id=rr.id),rr.created_at))<=now()-interval '2 hours'
       or s.retired_at<=now()-interval '1 hour'))) then
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

create function public.statistics_health() returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('snapshotId',s.id,'importedAt',s.metadata->>'importedAt',
  'ageSeconds',extract(epoch from now()-(s.metadata->>'importedAt')::timestamptz),
  'source',s.metadata->>'source','context',s.metadata->'context',
  'shards',(select count(*) from public.statistics_shards where snapshot_id=s.id),
  'pairs',(select coalesce(sum(jsonb_array_length(pairs)),0) from public.statistics_shards where snapshot_id=s.id),
  'coverage',(select jsonb_build_object('vs',count(*) filter(where p->>'relation'='vs'),'with',count(*) filter(where p->>'relation'='with'))
   from public.statistics_shards sh cross join lateral jsonb_array_elements(sh.pairs) p where sh.snapshot_id=s.id),
  'rooms',(select count(*) from public.rooms),
  'incomplete',(select count(*) from public.statistics_snapshots where not ready),
  'retired',(select count(*) from public.statistics_snapshots where retired_at is not null))
 from (select snapshot_id from public.statistics_current where singleton) c
 join public.statistics_snapshots s on s.id=c.snapshot_id
$$;
revoke all on function public.maintain_statistics(boolean),public.statistics_health() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
