# Best fits and team advantage

The draft offers a local, per-browser **Show best fits** preference, enabled by default. Explicit role pools are kept intact. Only an empty explicit pool receives popular fallback choices (five including the selected champion); short non-empty pools receive no popularity filler. The top three fits are computed over all admissible available champions before union/deduplication with that base list. A selected champion always remains visible and first, with every other candidate sorted by adjusted individual score.

Suggestions require at least 5% of the champion's games in that role, at least 5,000 role games, a valid shrinkage model, complete coverage of all current interactions, and a matching immutable reference context. No suggestion is invented for an empty or indistinguishable score reference. The enemy optimizes its own directional score. A star and hover explanation distinguish top-three membership from the existing exceptional-fit glow: a best fit need not be positive or an exceptional outlier. Disabling the option only changes the view, never pools, picks, room version or undo history.

The implementation reuses migration 022's compact reference RPC. Full shards are still fetched only for explicit/popular candidates and current picks. No new database schema, image endpoint or refresh change is included.

A central fixed-scale bar displays **ally team score minus enemy team score**; ally advantage extends left, enemy advantage right. Its color follows the advantaged team's blue/red side. Individual signed scores and coverage remain visible. The bar saturates at one point either way while retaining the exact numerical difference. Partial drafts or missing coverage say Provisional; an unknown team score shows Awaiting team scores. It is not a win probability.

Validation covers the agreed 0/1/3/6 candidate examples, deduplication, selected-first order, exclusion/reranking on bans and picks, role and coverage guards, enemy perspective, immutable reference loading, browser preference/reload, direct selection of a suggestion, observers, both signed team scores, fixed-scale saturation, reduced motion and mobile overflow.
