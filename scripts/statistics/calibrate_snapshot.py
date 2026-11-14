"""Fit the current immutable snapshot without recollecting; defaults to read-only.

--apply inserts ONLY its model record. No raw data, metadata, pointer or room is
updated. Aggregated sufficient statistics avoid downloading the whole corpus.
"""
import argparse
import json
from pathlib import Path
from calibration import fit
from publish import query, literal


def calibrate(apply=False, execute=query):
    row = execute('select s.id,s.metadata from public.statistics_current c join public.statistics_snapshots s on s.id=c.snapshot_id where s.ready')[0]
    sid = literal(row['id'])
    stats = execute(f"""select (p->>'games')::integer as games,count(*)::integer as count,
      sum(power((p->>'delta2')::double precision,2))::double precision as "sumSquares",
      count(*) filter(where p->>'relation'='vs')::integer as vs,
      count(*) filter(where p->>'relation'='with')::integer as "with"
      from public.statistics_shards s cross join lateral jsonb_array_elements(s.pairs) p
      where s.snapshot_id={sid} and p->>'delta2' is not null and (p->>'games')::integer>0
      group by (p->>'games')::integer order by games""")
    counts = {r:sum(s[r] for s in stats) for r in ('vs', 'with')}
    model = fit(stats, counts, row['metadata'])
    if apply:
        value = literal(json.dumps(model, separators=(',', ':')))
        execute(f"""begin; select pg_advisory_xact_lock(765432100);
          select id from public.statistics_snapshots where id={sid} for update;
          do $guard$ begin
            if not exists(select 1 from public.statistics_current where snapshot_id={sid})
            then raise exception 'Current snapshot changed; rerun calibration';end if;
          end $guard$;
          insert into public.statistics_calibrations(snapshot_id,model) values({sid},{value}::jsonb) on conflict do nothing;
          commit;""")
        model = execute(f'select model from public.statistics_calibrations where snapshot_id={sid}')[0]['model']
    return {'snapshotId':row['id'], 'applied':apply, 'model':model}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = calibrate(args.apply)
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))
