-- Read only the current-context pairs needed to compare the complete role catalogue.
-- Existing immutable raw data, calibrations, accounts and room state are unchanged.
begin;
create function public.draft_reference_pairs(snapshot_id text,context_picks jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public as $$
begin
 if snapshot_id is null or snapshot_id!~'^[a-f0-9]{64}$' then raise exception 'Invalid snapshot';end if;
 if jsonb_typeof(context_picks) is distinct from 'array' then raise exception 'Invalid reference context';end if;
 if jsonb_array_length(context_picks)>10 or exists(select 1 from jsonb_array_elements(context_picks) p where
  jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p->'championId') is distinct from 'string' or coalesce(p->>'championId','')!~'^[0-9]{1,6}$'
  or coalesce(p->>'role','') not in ('Top','Jungle','Mid','ADC','Support')) then raise exception 'Invalid reference context';end if;
 if not exists(select 1 from public.statistics_snapshots s where s.id=snapshot_id and s.ready) then raise exception 'Snapshot unavailable';end if;
 return (with eligible as materialized (
  select distinct (e->>'championId')||':'||(e->>'role') candidate_key from public.statistics_role_catalogues c
  cross join lateral jsonb_array_elements(c.catalogue->'entries') e
  where c.snapshot_id=draft_reference_pairs.snapshot_id and (e->>'lanePercent')::numeric>=5
 ) select coalesce(jsonb_agg(p),'[]'::jsonb) from eligible e join public.statistics_shards s
  on s.snapshot_id=draft_reference_pairs.snapshot_id and s.candidate_key=e.candidate_key
  cross join lateral jsonb_array_elements(s.pairs) p
  where exists(select 1 from jsonb_array_elements(context_picks) pick where pick->>'championId'=p->>'otherChampionId' and pick->>'role'=p->>'otherRole'));
end $$;
revoke all on function public.draft_reference_pairs(text,jsonb) from public,anon;
grant execute on function public.draft_reference_pairs(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
