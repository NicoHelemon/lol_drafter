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
- Verified response files are cached per daily target and collector/catalogue
  revision. A failed attempt saves its response cache; the next attempt rebuilds
  from those checksummed responses instead of re-fetching the same completed
  requests. Expired or corrupt cache data still fails validation. Cache failure
  does not prevent an uncached refresh.

The extra schedule events normally perform only a freshness read, not three
full daily collections. Failed collection/publication can be retried by the
next check. GitHub still offers no exact execution-time guarantee; this change
repairs late-run handling and adds recovery opportunities, not a guaranteed
external scheduler. A future complete absence of all cron events would still
require a manual refresh or an independent scheduler.

## Validation

60 Python tests pass, including historical delayed-run regression cases, Swiss
DST dates, daily deduplication, midnight/06:00 boundaries, missing/invalid/future
health timestamps, stale-export rejection before publication, failure reporting
and preservation of final SQL integrity checks. `actionlint` validates the
workflow. No source thresholds, score definitions, account settings or image
recognition features were changed.

## Source absence discovered during recovery

The first November 17 recovery attempt stopped at 416/865 targets on the public
Milio Jungle Build page returning HTTP 404. The response is a genuine Qwik error
page naming the exact champion, role and 14-day/Emerald+/Global/ranked context.
The independent build-team response is valid and has seven games in each of its
four ally-role totals. No partial snapshot was published.

For this narrowly verified tiny-role case (consistent totals of 1–100 games), the
collector keeps the real synergy observations and records the Build absence.
Unavailable Against observations and role popularity are left missing, never
fabricated as zero or copied from an old snapshot. An ordinary/proxy 404, context
mismatch, malformed synergy response, inconsistent totals, or a missing page for
a role with more than 100 synergy games still fails the refresh. This is not a
minimum-games filter: existing low-game observations remain included.

The November 17 recovery completed all **865 targets** and published snapshot
`6565fbabf346e99e6ddfdf89e6d7aabf5fe0efce42e8ddc6b3902c313de4883b`.
Collection finished at **15:47:55 Europe/Zurich**; publication was verified at
**15:54:42**. The snapshot is ready, non-fictional, and has **865 shards**,
**781,968 pairs** (430,587 Against / 351,381 Synergy), calibration k=2,510.048,
and **864 role metadata entries**. Milio Jungle's absent Build metadata is not
invented. The two registered accounts and two profiles remain present.

The actual post-publication scheduled check returns `allowed=false, due=false`
because the daily target is met: a backup event will not collect again. Complete
branch CI is green: **60 Python tests, 165 TypeScript/PostgreSQL tests, 50 browser
scenarios and build**. The real credential audit also passed on GitHub Actions.
Existing rooms keep their pinned snapshot; newly created rooms read this latest
published pointer. No application account or schema change was performed.

[Structured publication proof](daily-refresh-recovery-2026-11-17.json).

References:
- [November 15 delayed run](https://github.com/NicoHelemon/lol_drafter/actions/runs/43714416113)
- [November 16 delayed run](https://github.com/NicoHelemon/lol_drafter/actions/runs/43875666884)
- [November 17 delayed run](https://github.com/NicoHelemon/lol_drafter/actions/runs/44100276499)
- [GitHub schedule behavior and timezones](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## Room adoption (migration 025, November 19)

The historical publication proof above is unchanged. Rooms now adopt current data
in the lobby, including when returning from a draft. Live drafts retain their
snapshot until their host chooses **Update data**; all participants then hydrate
the same new snapshot. Publication no longer expires rooms using older data.
The morning trigger schedule and monitoring are unchanged.
