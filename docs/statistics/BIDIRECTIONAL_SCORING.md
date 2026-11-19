# Bidirectional interactions and fixed draft denominators

Local implementation on `feat/bidirectional-fixed-scoring`. No production
publication is authorized as part of this change.

The raw Lolalytics observations and sample counts remain unchanged. Each
original direction is first adjusted with the existing calibration:
`a = delta2_AB * n_AB / (n_AB + K)` and similarly for `b`.
An unavailable direction contributes zero to the arithmetic, while coverage
continues to identify the absence (a measured zero is an observed value).

- Ally interaction: `s_AB = (a + b) / 2 = s_BA`.
- Opponent interaction: `m_AB = (a - b) / 2 = -m_BA`.
- One direction only: always keep the divisor two; never double its sample count.
- Neither direction: zero contribution, unavailable interaction in the tooltip.
- Missing calibration: scores remain unavailable, not silently neutral.

Individual fit is the sum of current consolidated interactions divided by nine,
including in partial drafts. Team score is the sum of selected individual fits
divided by five, including empty team slots as zero. With a valid calibration,
an empty context has zero contribution and remains provisional.

Writing `D = S_ally - S_enemy`, a role-fixed allied addition contributes
`delta D = (2/5) F(candidate)`; a replacement contributes
`delta D = (2/5) [F(candidate) - F(previous)]`. For enemy choices the sign of the
global difference reverses. The preview reports a positive advantage change as
an improvement for the candidate's own team. Its own team-score change remains
separately labelled; that change alone is not the ranking objective.

The consolidated global advantage equals the original adjusted directional sum
with the same fixed denominators, even with missing directions counted as zero.
These are algebraic properties, not claims about predicted victory probability.

## Coverage and recommendations

`known` counts interactions with at least one usable direction. `complete` counts
interactions with both directions. Available direction count is `known+complete`.
Partial coverage remains visible even when an interaction can be calculated.

Best Fit retains its role share, role-game, availability and current-context
requirements. Each revealed interaction still needs usable data, but one
direction suffices; both directions are not made an eligibility requirement.
The selected pick remains first independently of ranking.

Exceptional fits keep the current role-universe quantiles and the 0.5-point gap
threshold on the new nine-slot scale. There is no additional `9/revealed` factor.
Partial drafts and partially observed directions retain provisional labels.

## Data loading and checks

Selected champions' complete shards already supply reverse directions for
reference-only suggestions. Shared hydration waits for these shards, so an
unfinished load is not treated as an absent observation. Reference outages still
suppress Best Fit suggestions without disabling ordinary scoring.

The tests cover per-direction shrinkage, mirror identities, measured zeros,
missing counts/directions, partial and full drafts, both team perspectives,
addition/replacement equivalence, fixed directional advantage and raw immutability.
Browser checks cover the matrix, replacement/advantage previews, eligibility,
highlights, empty evidence, unavailable calibration and mobile tooltips.

Local validation (19 November 2026): 184 unit/database tests, 64 browser scenarios
and the production build pass. The algebraic property checks include 120 seeded
partial/full contexts and 720 legal additions/replacements across both teams.
No source extraction, production database change, push or deployment was made.
