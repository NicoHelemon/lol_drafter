"""Daily freshness gate: delayed cron events catch up instead of silently skipping.

06:00 Europe/Zurich is the daily target, not a publication deadline. Scheduled
fallbacks only collect if the snapshot predates that target. Explicit manual
validation/publication remains available at any time.
"""
import argparse
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
import json
import os


ZURICH = ZoneInfo('Europe/Zurich')


def check(event=None, now=None, previous=None):
    event = event if event is not None else os.environ.get('GITHUB_EVENT_NAME', '')
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError('Schedule time must include a timezone')
    local = now.astimezone(ZURICH)
    day = local.date() if local.hour >= 6 else local.date() - timedelta(days=1)
    target = datetime.combine(day, time(6), ZURICH)
    captured = None
    if previous is not None:
        try:
            captured = datetime.fromisoformat(previous['importedAt'].replace('Z', '+00:00'))
        except (KeyError, TypeError, ValueError, AttributeError) as error:
            raise ValueError('Current statistics have an invalid collection date') from error
        if captured.tzinfo is None or captured > now + timedelta(minutes=5):
            raise ValueError('Current statistics have an invalid or future collection date')
    due = captured is None or captured < target
    allowed = event != 'schedule' or due
    delayed = event == 'schedule' and due and local.hour >= 8
    reason = ('Manual validation/publication requested; daily deduplication does not apply'
              if event != 'schedule' else 'Current snapshot already meets the daily target; no collection needed'
              if not due else 'Delayed daily refresh will catch up; publication is allowed'
              if delayed else 'Daily refresh is due; publication is allowed')
    return dict(allowed=allowed, due=due, delayed=delayed, event=event or 'local',
                utc=now.astimezone(timezone.utc).isoformat(), local=local.isoformat(),
                timezone='Europe/Zurich', dailyTarget=target.isoformat(),
                importedAt=captured.isoformat() if captured else None,
                snapshotId=previous.get('snapshotId') if previous else None, reason=reason)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify', action='store_true', help='Fail unless the published snapshot meets the daily target')
    args = parser.parse_args()
    from maintenance import health
    result = check(previous=health())
    print(json.dumps(result, ensure_ascii=False))
    if result['delayed']:
        print('::warning::'+result['reason'])
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
            summary.write(f"Daily target: **{result['dailyTarget']}**.\n\n"
                          f"Observed time: {result['local']}. Event: {result['event']}.\n\n"
                          f"Current collection: {result['importedAt'] or 'none'}.\n\n"
                          f"**{result['reason']}**\n")
    if args.verify and result['due']:
        raise SystemExit('Published statistics do not meet the daily target')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write(f"allowed={str(result['allowed']).lower()}\n")
            output.write(f"cache_date={result['dailyTarget'][:10]}\n")


if __name__ == '__main__':
    main()
