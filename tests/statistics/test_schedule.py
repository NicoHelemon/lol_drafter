"""Daily cron recovery and freshness checks; no remote services are contacted."""
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from io import StringIO
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/statistics'))
import maintenance
import schedule


def current(stamp):
    return dict(snapshotId='a'*64, importedAt=stamp)


class DailyScheduleTests(unittest.TestCase):
    def test_daily_six_oclock_target_tracks_winter_summer_and_dst_dates(self):
        for date, hour in [('2026-01-14',5), ('2026-07-14',4), ('2026-03-29',4), ('2026-10-25',5)]:
            with self.subTest(date=date):
                now = datetime.fromisoformat(f'{date}T{hour:02}:07:00+00:00')
                result = schedule.check('schedule', now)
                self.assertIn('T06:00:00', result['dailyTarget'])
                self.assertEqual(datetime.fromisoformat(result['dailyTarget']).astimezone(timezone.utc).hour, hour)
                self.assertTrue(result['due']); self.assertTrue(result['allowed'])

    def test_historical_late_runs_now_catch_up_instead_of_silently_skipping(self):
        for stamp in ['2026-11-15T12:33:07+00:00', '2026-11-16T13:25:55+00:00', '2026-11-17T14:10:47+00:00']:
            result = schedule.check('schedule', datetime.fromisoformat(stamp), current('2026-11-14T14:07:11Z'))
            self.assertTrue(result['allowed']); self.assertTrue(result['delayed'])
            self.assertIn('catch up', result['reason'])

    def test_backup_checks_skip_only_if_a_snapshot_already_meets_the_target(self):
        previous = current('2026-11-17T05:42:00Z')
        for stamp in ['2026-11-17T08:17:00Z', '2026-11-17T14:17:00Z', '2026-11-17T22:00:00Z']:
            result = schedule.check('schedule', datetime.fromisoformat(stamp), previous)
            self.assertFalse(result['due']); self.assertFalse(result['allowed'])
            self.assertIn('no collection needed', result['reason'])
        # Any late publication still fulfills that daily target.
        result = schedule.check('schedule', datetime.fromisoformat('2026-11-17T22:00:00Z'), current('2026-11-17T19:00:00Z'))
        self.assertFalse(result['allowed'])

    def test_previous_days_snapshot_is_due_again_after_six_and_midnight_does_not_collect_twice(self):
        previous = current('2026-11-16T05:42:00Z')
        self.assertFalse(schedule.check('schedule', datetime.fromisoformat('2026-11-17T04:59:59Z'), previous)['allowed'])
        self.assertTrue(schedule.check('schedule', datetime.fromisoformat('2026-11-17T05:00:00Z'), previous)['allowed'])
        self.assertTrue(schedule.check('schedule', datetime.fromisoformat('2026-11-17T01:00:00Z'), current('2026-11-14T05:42:00Z'))['allowed'])

    def test_six_oclock_boundary_is_inclusive_and_manual_validation_or_force_remains_available(self):
        now = datetime.fromisoformat('2026-11-17T05:00:00Z')
        self.assertFalse(schedule.check('schedule', now, current(now.isoformat()))['allowed'])
        self.assertTrue(schedule.check('schedule', now, current((now-timedelta(seconds=1)).isoformat()))['allowed'])
        self.assertTrue(schedule.check('workflow_dispatch', now, current(now.isoformat()))['allowed'])
        self.assertTrue(schedule.check('workflow_dispatch', now, current((now-timedelta(days=3)).isoformat()))['allowed'])

    def test_bad_health_dates_fail_visibly_instead_of_claiming_freshness(self):
        now = datetime.fromisoformat('2026-11-17T05:00:00Z')
        for previous in [{}, current(None), current('invalid'), current('2026-11-17T05:00:00'), current('2026-11-17T06:00:00Z')]:
            with self.subTest(previous=previous), self.assertRaises(ValueError):
                schedule.check('schedule', now, previous)
        with self.assertRaises(ValueError): schedule.check('schedule', now.replace(tzinfo=None))

    def test_cli_outputs_due_state_and_summary_and_read_failure_is_not_success(self):
        with tempfile.TemporaryDirectory() as folder:
            out, summary = Path(folder)/'out', Path(folder)/'summary'
            with patch.dict('os.environ', {'GITHUB_EVENT_NAME':'schedule', 'GITHUB_OUTPUT':str(out), 'GITHUB_STEP_SUMMARY':str(summary)}), \
                    patch.object(maintenance, 'health', return_value=None), patch.object(sys, 'argv', ['schedule.py']), redirect_stdout(StringIO()):
                schedule.main()
            self.assertIn('allowed=true', out.read_text()); self.assertIn('Daily target', summary.read_text())
            with patch.object(maintenance, 'health', side_effect=RuntimeError('backend unavailable')), \
                    patch.object(sys, 'argv', ['schedule.py']), self.assertRaises(RuntimeError):
                schedule.main()

    def test_postpublication_verification_fails_for_stale_data_and_accepts_fresh_data(self):
        with patch.dict('os.environ', {'GITHUB_OUTPUT':'', 'GITHUB_STEP_SUMMARY':''}), patch.object(sys, 'argv', ['schedule.py', '--verify']), redirect_stdout(StringIO()):
            with patch.object(maintenance, 'health', return_value=None), self.assertRaisesRegex(SystemExit, 'daily target'):
                schedule.main()
            with patch.object(maintenance, 'health', return_value=current(datetime.now(timezone.utc).isoformat())):
                schedule.main()
