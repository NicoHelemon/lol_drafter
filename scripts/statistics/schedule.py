"""Guard automatic collection/publication against delayed GitHub cron delivery."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import json
import os


def check(event=None, now=None):
    event = event if event is not None else os.environ.get('GITHUB_EVENT_NAME', '')
    now = now or datetime.now(timezone.utc)
    local = now.astimezone(ZoneInfo('Europe/Zurich'))
    allowed = event != 'schedule' or 6 <= local.hour < 8
    return dict(allowed=allowed, event=event or 'local', utc=now.isoformat(),
                local=local.isoformat(), timezone='Europe/Zurich', window='06:00–08:00',
                reason='Within automatic morning window' if event == 'schedule' and allowed
                else 'Delayed automatic refresh skipped; current data preserved' if not allowed
                else 'Explicit manual operation; automatic time window does not apply')


def require_window():
    result = check()
    if not result['allowed']:
        raise ValueError(result['reason'])


if __name__ == '__main__':
    result = check()
    print(json.dumps(result, ensure_ascii=False))
    if not result['allowed']:
        print('::warning::'+result['reason'])
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
            summary.write(f"Automatic refresh window: **{result['window']} Europe/Zurich**.\n\n"
                          f"Observed time: {result['local']}. Event: {result['event']}.\n\n"
                          f"**{result['reason']}**\n")
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write(f"allowed={str(result['allowed']).lower()}\n")
