-- Add model records beside immutable raw snapshots; no rewrite or data reset.
begin;
create table public.statistics_calibrations (
 snapshot_id text primary key references public.statistics_snapshots(id) on delete cascade,
 model jsonb not null check(
  model ?& array['method','k','priorVariance','noiseVariance','observations','relationCounts','contextKey','trainingSnapshotId','fittedAt','reviewAfter']
  and jsonb_typeof(model)='object'
  and
  model->>'method'='normal-normal-v1' and model->>'noiseVariance'='2500'
  and jsonb_typeof(model->'priorVariance')='number' and (model->>'priorVariance')::numeric>=0
  and ((model->'k'='null'::jsonb and (model->>'priorVariance')::numeric=0)
    or (jsonb_typeof(model->'k')='number' and (model->>'k')::numeric>0 and (model->>'priorVariance')::numeric>0))
  and (model->>'observations')::integer>0
  and (model->'relationCounts'->>'vs')::integer>0 and (model->'relationCounts'->>'with')::integer>0
  and (model->>'observations')::integer=(model->'relationCounts'->>'vs')::integer+(model->'relationCounts'->>'with')::integer
  and model->>'contextKey' ~ '^[a-f0-9]{64}$'
  and model->>'trainingSnapshotId' ~ '^[a-f0-9]{64}$'
  and (model->>'fittedAt')::timestamptz is not null and (model->>'reviewAfter')::timestamptz>(model->>'fittedAt')::timestamptz
 )
);
alter table public.statistics_calibrations enable row level security;
create policy read_ready_calibration on public.statistics_calibrations for select to authenticated
 using(exists(select 1 from public.statistics_snapshots s where s.id=snapshot_id and s.ready));
revoke all on public.statistics_calibrations from anon,authenticated;
grant select on public.statistics_calibrations to authenticated;
create function public.protect_statistics_calibration() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'Snapshot calibration is immutable';end $$;
revoke all on function public.protect_statistics_calibration() from public,anon,authenticated;
create trigger protect_statistics_calibration before update on public.statistics_calibrations
 for each row execute function public.protect_statistics_calibration();
notify pgrst,'reload schema';
commit;
