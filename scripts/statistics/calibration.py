"""Shared zero-centred normal/normal EB calibration; raw pairs remain immutable.

2500/n is an approximate sampling variance in percentage-point units, not an
exact standard error for Lolalytics Delta 2. Correlated pairs give a working
(composite) likelihood. Temporal predictive validation remains necessary.
"""
from collections import defaultdict
from datetime import datetime, timezone, timedelta
import hashlib
import json
import math

METHOD = 'normal-normal-v1'
NOISE = 2500
RECALIBRATE_DAYS = 30


def context_key(metadata):
    raw = json.dumps({'source': metadata['source'], 'context': metadata.get('context'),
                      'tier': metadata['tier'], 'method': METHOD}, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(raw.encode()).hexdigest()


def summarize(groups):
    moments = defaultdict(lambda: [0, 0.0])
    counts = {'vs': 0, 'with': 0}
    for pairs in groups.values():
        for p in pairs:
            if p['delta2'] is None or p.get('games', 0) <= 0:
                continue
            n, d = p['games'], p['delta2']
            moments[n][0] += 1
            moments[n][1] += d*d
            counts[p['relation']] += 1
    return [{'games': n, 'count': count, 'sumSquares': squares}
            for n, (count, squares) in sorted(moments.items())], counts


def fit(moments, counts, metadata, now=None):
    now = now or datetime.now(timezone.utc)
    if any(counts.get(r, 0) <= 0 for r in ('vs', 'with')) or not moments:
        raise ValueError('Calibration requires positive-game Against and Synergy observations')
    for row in moments:
        if (type(row['games']) is not int or row['games'] <= 0 or row['count'] <= 0
                or not math.isfinite(row['sumSquares']) or row['sumSquares'] < 0):
            raise ValueError('Invalid calibration moments')
    total = sum(r['count'] for r in moments)
    if total != sum(counts.values()):
        raise ValueError('Calibration observation count mismatch')
    # Grouping by n gives exactly the same objective as iterating over all pairs.
    def objective(variance):
        return math.fsum(r['count']*math.log(variance+NOISE/r['games'])
                         + r['sumSquares']/(variance+NOISE/r['games']) for r in moments)/total
    upper = max(r['sumSquares']/r['count'] for r in moments)
    candidates = [(objective(0), 0.)]
    if upper > 0:
        # Search log-scale basins, then refine each minimum; include the boundary.
        grid = [0.] + [upper*10**(-10+10*i/120) for i in range(121)]
        values = [objective(x) for x in grid]
        candidates.extend(zip(values, grid))
        golden = (math.sqrt(5)-1)/2
        for i in range(1, len(grid)-1):
            if values[i] > values[i-1] or values[i] > values[i+1]:
                continue
            a, b = grid[i-1], grid[i+1]
            c, d = b-golden*(b-a), a+golden*(b-a)
            fc, fd = objective(c), objective(d)
            for _ in range(65):
                if fc < fd:
                    b, d, fd = d, c, fc
                    c = b-golden*(b-a); fc = objective(c)
                else:
                    a, c, fc = c, d, fd
                    d = a+golden*(b-a); fd = objective(d)
            x = (a+b)/2; candidates.append((objective(x), x))
    _, variance = min(candidates)
    return dict(method=METHOD, k=NOISE/variance if variance else None,
                priorVariance=variance, noiseVariance=NOISE,
                fittedAt=now.isoformat(), reviewAfter=(now+timedelta(days=RECALIBRATE_DAYS)).isoformat(),
                trainingSnapshotId=metadata['snapshotId'], contextKey=context_key(metadata),
                observations=total, relationCounts=counts)


def reusable(model, metadata, now=None):
    now = now or datetime.now(timezone.utc)
    if model.get('method') != METHOD or model.get('contextKey') != context_key(metadata):
        return False
    try:
        fitted = datetime.fromisoformat(model['fittedAt'].replace('Z', '+00:00'))
        return timedelta(0) <= now-fitted < timedelta(days=RECALIBRATE_DAYS)
    except (ValueError, KeyError, TypeError):
        return False
