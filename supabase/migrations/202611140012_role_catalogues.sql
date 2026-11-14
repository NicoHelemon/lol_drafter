-- Optional small metadata alongside immutable raw statistics. No raw rewrite.
begin;
create table public.statistics_role_catalogues (
 snapshot_id text primary key references public.statistics_snapshots(id) on delete cascade,
 catalogue jsonb not null check((catalogue->>'schemaVersion'='1'
  and jsonb_typeof(catalogue->'entries')='array' and jsonb_array_length(catalogue->'entries') between 1 and 5000
  and (catalogue->>'capturedAt')::timestamptz is not null) is true)
);
alter table public.statistics_role_catalogues enable row level security;
create policy read_ready_role_catalogue on public.statistics_role_catalogues for select to authenticated
 using(exists(select 1 from public.statistics_snapshots s where s.id=snapshot_id and s.ready));
revoke all on public.statistics_role_catalogues from anon,authenticated;
grant select on public.statistics_role_catalogues to authenticated;
create trigger protect_role_catalogue before update on public.statistics_role_catalogues for each row execute function public.protect_statistics_calibration();
notify pgrst,'reload schema';
commit;
