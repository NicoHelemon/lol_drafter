# Exceptional draft fits — 17 November 2026

Positive and negative outliers receive a green/red luminous outline and a stronger score. The gold selected-pick border and selected-first order remain visible. Hover/focus adds “Excellent fit” / “Poor fit”, a short team-specific explanation and the gap from a typical role alternative. Motion is disabled with prefers-reduced-motion.

The rule follows the [offline calibration](../experiments/EXCEPTIONAL_PICK_CALIBRATION.md): compare all available champions passing the existing 5% role-share filter, use linear-interpolated percentiles 95/5 and median, require a coherent score sign and a median gap of at least `0.5 × 9 / m`. Here m is the number of other champions present, 1–9. Every present interaction must be known; at least twenty reference scores are required. Partial drafts say Provisional. Banned/otherwise selected candidates never glow. No account or personal-pool restriction affects the reference population. Scores and ranking themselves are unchanged.

Migration 022 adds a read-only authenticated RPC, subject to existing published-snapshot RLS. It returns only catalogue pairs against the current champion/role slots, avoiding downloads of all complete catalogue shards. Data stays local, is validated and merged without duplicates, and is never sent back in room updates. Cache keys include immutable snapshot and sorted champion/role context; bans/pool changes reuse the loaded pairs, while client reference calculations reapply availability. Eight contexts are retained. An optional reference failure leaves normal scores available, without highlights, and can retry.

Tests cover full-universe comparisons, partial thresholds and exact boundaries, missing data, blocked picks, enemy perspective, selected-first behavior, reference cache/retries/validation, authenticated RPC/RLS and input bounds. Browser checks cover positive/negative glow, explanations, selection, mobile and reduced motion. Local full suites: 157 TypeScript/PostgreSQL and 41 browser scenarios; build passed. SQL read-only profiling on the actual current snapshot with ten picks took about 1.49 seconds of server execution on this environment; that is an observation, not a latency guarantee.

Screenshot recognition remains a separate offline experiment. No image endpoint or upload UI is included.

Hosted deployment and verification are recorded after completion.
