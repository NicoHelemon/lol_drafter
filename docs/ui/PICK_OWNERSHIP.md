# Selected picks and ownership — 17 November 2026

Selected champions are pinned first on both teams, including when their score is unknown or worse than the alternatives. Remaining candidates retain descending adjusted-score order, with unknown scores last. This replaces the previous score-only ordering for the selected champion; scoring itself is unchanged.

A non-host active participant can select, replace or clear their own ally pick, unoccupied ally picks, and enemy picks. They cannot directly change another participant's selected ally champion or drag that champion away. The host can directly edit any pick, including as an observer. Other observers remain read-only. Candidate lists remain collaborative among active participants and the host, both in preparation and during the draft.

Moving one's own champion to another occupied ally role still requests the existing consented trade. Accepted champion trades and role swaps retain their existing server validations. These are distinct from directly selecting a champion for somebody else. Migration 021 enforces ownership on room-state updates, not just disabled buttons; the move RPC also rejects unauthorized sources. The candidate RPC permits collaborative preparation edits without changing selections.

Local verification: 150 TypeScript/PostgreSQL checks and 50 Python checks passed; build passed. Browser verification and hosted deployment evidence are recorded after completion. Meaningful PostgreSQL cases cover peer selection/replacement/removal rejection, host override, candidate edits in both phases, free/enemy roles, rejected peer drags and an accepted trade. Existing role-swap tests remain in the suite.

Screenshot recognition remains an [isolated offline experiment](../experiments/SCREENSHOT_POC.md). Exceptional-pick highlights are a discussion only and were not implemented.
