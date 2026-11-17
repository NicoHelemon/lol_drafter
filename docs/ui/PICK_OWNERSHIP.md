# Selected picks and ownership — 17 November 2026

Selected champions are pinned first on both teams, including when their score is unknown or worse than the alternatives. Remaining candidates retain descending adjusted-score order, with unknown scores last. This replaces the previous score-only ordering for the selected champion; scoring itself is unchanged.

A non-host active participant can select, replace or clear their own ally pick, unoccupied ally picks, and enemy picks. They cannot directly change another participant's selected ally champion or drag that champion away. The host can directly edit any pick, including as an observer. Other observers remain read-only. Candidate lists remain collaborative among active participants and the host, both in preparation and during the draft.

Moving one's own champion to another occupied ally role still requests the existing consented trade. Accepted champion trades and role swaps retain their existing server validations. These are distinct from directly selecting a champion for somebody else. Migration 021 enforces ownership on room-state updates, not just disabled buttons; the move RPC also rejects unauthorized sources. The candidate RPC permits collaborative preparation edits without changing selections.

Local verification: 150 TypeScript/PostgreSQL checks and 50 Python checks passed; build passed. All 39 browser scenarios also passed (239 checks in total), including the new peer selection/drag restriction and selected-first assertion. Meaningful PostgreSQL cases cover peer selection/replacement/removal rejection, host override, candidate edits in both phases, free/enemy roles, rejected peer drags and an accepted trade. Existing role-swap tests remain in the suite.

Screenshot recognition remains an [isolated offline experiment](../experiments/SCREENSHOT_POC.md). Exceptional-pick highlights are a discussion only and were not implemented.

## Hosted verification

Production commit `fc3a73083ced9a39555d6b20111f925a7763ac27` was observed on 17 November 2026 at 11:48 Europe/Zurich. Branch and main CI are green. Migration 021 was applied after a private backup; one disposable room was reset under the standing authorization. Final comparison preserves the two registered accounts, profiles/pools/logins, all 865 shard fingerprints, snapshot metadata, calibration and role catalogue. All temporary test rooms were removed.

Three isolated browser sessions verified an observer host and two non-host role owners: peer candidate edits work in lobby and live draft; a selected score of −1.43 remains first despite a +0.37 alternative; peer selection/removal/drag controls are disabled; direct forged selection and move RPCs are rejected by the hosted server; the host can override, the owner can replace/clear, and a mutually accepted champion trade still works. Mobile remains within the viewport. A separate real-statistics smoke test retains Renekton +0.97, team +0.40 and Camille replacement +0.27, including reload and coverage. Neither check contacts Lolalytics.

[Structured verification](evidence/pick-ownership-production-verification.json), [non-host view](evidence/pick-ownership-nonhost.png), [mobile view](evidence/pick-ownership-mobile.png). Initial browser attempts stopped before room creation because Chromium lacked the environment proxy CA; reruns trust only the provided CA fingerprint, with no global TLS bypass. The first local browser invocation also omitted the installed Chromium path; the corrected full run is the 39-pass result above.
