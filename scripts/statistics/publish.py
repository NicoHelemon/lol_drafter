"""Publish a verified local snapshot to Supabase; promote only after all shards.

Requires SUPABASE_ACCESS_TOKEN (management token) and SUPABASE_PROJECT_REF.
This is an offline administrative command; it is never included in the frontend.
"""
import argparse
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen
from pipeline import encoded, verify


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


def publish(directory, execute=query):
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
    if not ready:
        execute(f"insert into public.statistics_snapshots(id,metadata) values({sid},{meta}::jsonb) on conflict do nothing")
        for key, pairs in sorted(groups.items()):
            # Idempotent retry of an unfinished publish; ready snapshots reject edits.
            execute(f"insert into public.statistics_shards(snapshot_id,candidate_key,pairs) "
                    f"values({sid},{literal(key)},{literal(encoded(pairs).decode())}::jsonb) "
                    "on conflict(snapshot_id,candidate_key) do update set pairs=excluded.pairs")
    # Completeness verification AND pointer change in one database transaction.
    # Old current stays valid on any HTTP or SQL failure before/inside this query.
    execute(f"""begin;
      select id from public.statistics_snapshots where id={sid} for update;
      do $check$ begin
        if (select count(*) from public.statistics_shards where snapshot_id={sid}) <> {len(groups)}
          or (select coalesce(sum(jsonb_array_length(pairs)),0) from public.statistics_shards where snapshot_id={sid}) <> {manifest['pairCount']}
        then raise exception 'Incomplete snapshot';end if;
      end $check$;
      update public.statistics_snapshots set ready=true where id={sid} and not ready;
      insert into public.statistics_current(singleton,snapshot_id) values(true,{sid})
        on conflict(singleton) do update set snapshot_id=excluded.snapshot_id;
      commit;""")
    return {'snapshotId': metadata['snapshotId'], 'shards': len(groups), 'pairs': manifest['pairCount']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    print(json.dumps(publish(args.directory), indent=2))
