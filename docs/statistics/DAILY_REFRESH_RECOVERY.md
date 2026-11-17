# Daily refresh recovery — 17 November 2026

## Diagnosis

The 06:00 Europe/Zurich cron was correctly configured for Swiss summer/winter
time. Actual runs were created at 13:33 Swiss time on November 15, 14:25 on
November 16, and 15:10 on November 17. A recently added 06:00–08:00 gate made
each late run return `allowed=false`; validation and refresh were skipped while
the whole workflow remained green. The shared pointer therefore stayed at the
November 14 snapshot (`603d125…`). This affected published data, not just a PDF.

The observed delay precedes job execution; GitHub does not expose its internal
cause in the run API. Its documentation warns that scheduled events can be
delayed or dropped under load, especially at the start of an hour. Changing the
timezone alone would not fix this failure.

## Current behavior

- Primary attempt: **06:07 Europe/Zurich**, avoiding the busiest minute.
- Recovery checks: **09:17 and 15:17**, in the same timezone.
- The scheduled gate reads `statistics_health()` and compares `importedAt` to
  the latest **06:00 Swiss daily target**. It skips only if that target is
  already met. Before 06:00, it uses the previous day's target.
- A delayed event is allowed to catch up. There is no collection or publication
  deadline at 08:00, including in the final SQL transaction.
- Manual runs retain explicit `publish=false` by default. The audit still runs
  even when statistics are current; deliberate manual publication can run again.
- Source dates are checked against the daily target before publishing, and the
  workflow verifies published freshness afterward. Backend/read/collection/
  publication errors fail the run instead of silently skipping stale data.
- Existing concurrency serialization, complete-shard validation, coverage-drop
  checks, calibration checks and atomic pointer promotion remain in place.

The extra schedule events normally perform only a freshness read, not three
full daily collections. Failed collection/publication can be retried by the
next check. GitHub still offers no exact execution-time guarantee; this change
repairs late-run handling and adds recovery opportunities, not a guaranteed
external scheduler. A future complete absence of all cron events would still
require a manual refresh or an independent scheduler.

## Validation

57 Python tests pass, including historical delayed-run regression cases, Swiss
DST dates, daily deduplication, midnight/06:00 boundaries, missing/invalid/future
health timestamps, stale-export rejection before publication, failure reporting
and preservation of final SQL integrity checks. `actionlint` validates the
workflow. No source thresholds, score definitions, account settings or image
recognition features were changed.

The full November 17 recovery collection is being checked separately; publication
evidence will be recorded once it completes. Existing rooms keep their pinned
snapshot; newly created rooms read the latest published pointer.

References:
- [November 15 delayed run](https://github.com/NicoHelemon/lol_drafter/actions/runs/43714416113)
- [November 16 delayed run](https://github.com/NicoHelemon/lol_drafter/actions/runs/43875666884)
- [November 17 delayed run](https://github.com/NicoHelemon/lol_drafter/actions/runs/44100276499)
- [GitHub schedule behavior and timezones](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
