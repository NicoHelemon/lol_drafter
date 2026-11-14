"""Publish a verified local snapshot to Supabase; promote only after all shards.

Requires SUPABASE_ACCESS_TOKEN (management token) and SUPABASE_PROJECT_REF.
This is an offline administrative command; it is never included in the frontend.
"""
import argparse
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from pipeline import encoded, verify
from calibration import context_key, fit, reusable, summarize
from schedule import require_window


def literal(value):
    # SQL literal escaping, not shell quoting. PostgreSQL standard_conforming_strings.
    return "'" + value.replace("'", "''") + "'"


def query(sql):
    project = os.environ['SUPABASE_PROJECT_REF']
    if not project.isalnum():
        raise ValueError('Invalid project reference')
    request = Request(f'https://api.supabase.com/v1/projects/{project}/database/query',
                      data=json.dumps({'query': sql}).encode(),
                      headers={'Authorization': 'Bearer ' + os.environ['SUPABASE_ACCESS_TOKEN'],
                               'Content-Type': 'application/json'})
    with urlopen(request, timeout=60) as response:
        return json.load(response)


def publish(directory, execute=query, max_batch_bytes=900_000, progress=None):
    require_window()
    manifest, groups = verify(directory)  # No remote changes before full validation.
    metadata = manifest['metadata']
    if metadata['fictional']:
        raise ValueError('Refusing to promote fictional statistics to the shared daily source')
    if not all(manifest['coverage'].get(relation, 0) for relation in ('vs', 'with')):
        raise ValueError('Against and Synergy observations are required for promotion')
    sid = literal(metadata['snapshotId'])
    meta = literal(encoded(metadata).decode())
    rows = execute(f"select metadata,ready from public.statistics_snapshots where id={sid}")
    if rows and rows[0]['metadata'] != metadata:
        raise ValueError('Existing snapshot has different metadata')
    ready = bool(rows and rows[0]['ready'])
    models = execute(f"select model from public.statistics_calibrations where snapshot_id={sid}")
    if models:
        model = models[0]['model']
    else:
        previous = execute(f"""select c.model from public.statistics_calibrations c
          join public.statistics_snapshots s on s.id=c.snapshot_id where s.ready
          and c.model->>'contextKey'={literal(context_key(metadata))}
          order by (c.model->>'fittedAt')::timestamptz desc limit 1""")
        model = previous[0]['model'] if previous and reusable(previous[0]['model'], metadata) else fit(*summarize(groups), metadata)
    model_sql = literal(encoded(model).decode())
    if not ready:
        execute(f"insert into public.statistics_snapshots(id,metadata) values({sid},{meta}::jsonb) on conflict do nothing")
        prefix = "insert into public.statistics_shards(snapshot_id,candidate_key,pairs) values"
        suffix = " on conflict(snapshot_id,candidate_key) do update set pairs=excluded.pairs"
        base_size = len(json.dumps({'query': prefix + suffix}).encode())
        batch, size = [], base_size
        uploaded = 0

        def write_batch(rows):
            nonlocal uploaded
            sql = prefix + ','.join(rows) + suffix
            try:
                execute(sql)
            except HTTPError as error:
                reason = error.read().decode('utf-8', errors='replace').lower()
                if (len(rows) > 1 and (error.code == 413 or
                        (error.code == 503 and any(s in reason for s in
                         ('request size too large', 'payload too large'))))):
                    middle = len(rows) // 2
                    write_batch(rows[:middle]); write_batch(rows[middle:])
                    return
                raise
            uploaded += len(rows)
            if progress:
                progress(uploaded, len(groups))

        for key, pairs in sorted(groups.items()):
            row = f"({sid},{literal(key)},{literal(encoded(pairs).decode())}::jsonb)"
            row_size = len(json.dumps(row).encode()) - 2
            if base_size + row_size > max_batch_bytes:
                raise ValueError('A shard exceeds the configured publication request limit')
            extra = row_size + bool(batch)
            if batch and size + extra > max_batch_bytes:
                write_batch(batch); batch, size = [], base_size
                extra = row_size
            batch.append(row); size += extra
        if batch:
            write_batch(batch)
    # Completeness verification AND pointer change in one database transaction.
    # Old current stays valid on any HTTP or SQL failure before/inside this query.
    require_window()
    scheduled_sql = 'true' if os.environ.get('GITHUB_EVENT_NAME') == 'schedule' else 'false'
    execute(f"""begin;
      select pg_advisory_xact_lock(765432100);
      select id from public.statistics_snapshots where id={sid} for update;
      do $check$ begin
        if {scheduled_sql} and ((clock_timestamp() at time zone 'Europe/Zurich')::time < time '06:00'
          or (clock_timestamp() at time zone 'Europe/Zurich')::time >= time '08:00')
        then raise exception 'Automatic publication outside Swiss morning window';end if;
        if (select count(*) from public.statistics_shards where snapshot_id={sid}) <> {len(groups)}
          or (select coalesce(sum(jsonb_array_length(pairs)),0) from public.statistics_shards where snapshot_id={sid}) <> {manifest['pairCount']}
        then raise exception 'Incomplete snapshot';end if;
      end $check$;
      insert into public.statistics_calibrations(snapshot_id,model) values({sid},{model_sql}::jsonb) on conflict do nothing;
      do $model$ begin
        if (select model from public.statistics_calibrations where snapshot_id={sid}) is distinct from {model_sql}::jsonb
        then raise exception 'Calibration conflict';end if;
      end $model$;
      update public.statistics_snapshots set ready=true where id={sid} and not ready;
      insert into public.statistics_current(singleton,snapshot_id) values(true,{sid})
        on conflict(singleton) do update set snapshot_id=excluded.snapshot_id;
      commit;""")
    return {'snapshotId': metadata['snapshotId'], 'shards': len(groups), 'pairs': manifest['pairCount'], 'calibration':model}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    print(json.dumps(publish(args.directory), indent=2))
