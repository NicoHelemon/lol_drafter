"""Administrative lifecycle commands; defaults to a preview, never runs in browsers."""
import argparse
import json
from publish import query


def health(execute=query):
    rows = execute('select public.statistics_health() as health')
    return rows[0]['health'] if rows else None


def maintain(execute=query, dry_run=True):
    rows = execute(f"select public.maintain_statistics({'true' if dry_run else 'false'}) as maintenance")
    return rows[0]['maintenance']


def audit(execute=query):
    # Read-only preflight also works BEFORE migration 008, without exposing rooms.
    rows = execute("""select
      (select snapshot_id from public.statistics_current) as snapshot_id,
      (select count(*) from public.statistics_shards where snapshot_id=(select snapshot_id from public.statistics_current)) as shards,
      (select coalesce(sum(jsonb_array_length(pairs)),0) from public.statistics_shards where snapshot_id=(select snapshot_id from public.statistics_current)) as pairs,
      exists(select 1 from information_schema.columns where table_schema='public' and table_name='statistics_snapshots' and column_name='retired_at') as retention_installed,
      exists(select 1 from pg_extension where extname='pg_cron') as cron_installed""")
    return rows[0]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true', help='Delete expired data (default: preview only)')
    parser.add_argument('--audit', action='store_true', help='Read-only audit, compatible with migration 007')
    args = parser.parse_args()
    if args.audit and args.execute:
        parser.error('--audit and --execute cannot be combined')
    print(json.dumps(audit() if args.audit else dict(maintenance=maintain(dry_run=not args.execute), health=health()), indent=2))
