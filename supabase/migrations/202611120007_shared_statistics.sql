-- Shared, immutable statistical snapshots. Rooms retain metadata + a reference.
-- No room reset, scoring change or change to membership/host permissions.
begin;
create table public.statistics_snapshots (
 id text primary key check(id ~ '^[a-f0-9]{64}$'),
 metadata jsonb not null,
 ready boolean not null default false,
 created_at timestamptz not null default now(),
 check(metadata->>'snapshotId'=id)
);
create table public.statistics_shards (
 snapshot_id text not null references public.statistics_snapshots(id),
 candidate_key text not null check(candidate_key ~ '^[0-9]{1,5}:(Top|Jungle|Mid|ADC|Support)$'),
 pairs jsonb not null check(jsonb_typeof(pairs)='array'),
 primary key(snapshot_id,candidate_key)
);
create table public.statistics_current (
 singleton boolean primary key default true check(singleton),
 snapshot_id text not null references public.statistics_snapshots(id)
);
alter table public.statistics_snapshots enable row level security;
alter table public.statistics_shards enable row level security;
alter table public.statistics_current enable row level security;
create policy read_ready_statistics on public.statistics_snapshots for select to authenticated using(ready);
create policy read_ready_shards on public.statistics_shards for select to authenticated using(exists(select 1 from public.statistics_snapshots s where s.id=snapshot_id and s.ready));
create policy read_statistics_pointer on public.statistics_current for select to authenticated using(true);
revoke all on public.statistics_snapshots,public.statistics_shards,public.statistics_current from anon,authenticated;
grant select on public.statistics_snapshots,public.statistics_shards,public.statistics_current to authenticated;

-- The application cannot write shared data directly. Existing authorized host
-- imports are offloaded atomically by the room trigger after validate_draft.
create function public.externalize_room_statistics() returns trigger language plpgsql security definer set search_path=public as $$
declare ds jsonb; sid text; meta jsonb; existing_meta jsonb; is_ready boolean;
begin
 ds=new.state->'dataset';
 if ds?'snapshotId' then
  sid=ds->>'snapshotId';
  select metadata,ready into meta,is_ready from public.statistics_snapshots where id=sid;
  if meta is null or not coalesce(is_ready,false) or ds-'pairs' is distinct from meta or ds->'pairs' is distinct from '[]'::jsonb then
   raise exception 'Invalid shared statistics reference';
  end if;
 else
  -- Validate again here, including direct admin writes/migration of room rows.
  perform public.validate_draft(new.state);
  sid=encode(sha256(convert_to(ds::text,'UTF8')),'hex');
  meta=(ds-'pairs')||jsonb_build_object('snapshotId',sid);
  insert into public.statistics_snapshots(id,metadata) values(sid,meta) on conflict do nothing;
  select metadata,ready into existing_meta,is_ready from public.statistics_snapshots where id=sid for update;
  if existing_meta is distinct from meta then raise exception 'Snapshot identity collision';end if;
  if not is_ready then
   insert into public.statistics_shards(snapshot_id,candidate_key,pairs)
    select sid,(p->>'candidateChampionId')||':'||(p->>'candidateRole'),jsonb_agg(p)
    from jsonb_array_elements(ds->'pairs') p group by p->>'candidateChampionId',p->>'candidateRole';
   update public.statistics_snapshots set ready=true where id=sid;
  end if;
 end if;
 new.state=jsonb_set(new.state,'{dataset}',meta||jsonb_build_object('pairs','[]'::jsonb));
 return new;
end $$;
revoke all on function public.externalize_room_statistics() from public;
create trigger rooms_share_statistics before insert or update of state on public.rooms
 for each row execute function public.externalize_room_statistics();
-- Move any current inline datasets once. No room or draft is deleted.
update public.rooms set state=state where not (state->'dataset'?'snapshotId');

-- Once ready, a snapshot is immutable even to accidental administrative edits.
create function public.protect_ready_statistics() returns trigger language plpgsql set search_path=public as $$
begin
 if tg_table_name='statistics_snapshots' then
  if old.ready then raise exception 'Ready snapshots are immutable';end if;
 else
  if exists(select 1 from public.statistics_snapshots where id=case when tg_op='INSERT' then new.snapshot_id else old.snapshot_id end and ready)
   or (tg_op='UPDATE' and exists(select 1 from public.statistics_snapshots where id=new.snapshot_id and ready)) then
   raise exception 'Ready snapshots are immutable';
  end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function public.protect_ready_statistics() from public;
create trigger protect_statistics_metadata before update or delete on public.statistics_snapshots
 for each row execute function public.protect_ready_statistics();
create trigger protect_statistics_pairs before insert or update or delete on public.statistics_shards
 for each row execute function public.protect_ready_statistics();
notify pgrst,'reload schema';
commit;
