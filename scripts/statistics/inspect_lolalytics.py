"""Inspect saved public Build HTML and normalize Against/Synergy role tables.

No network here: collect_lolalytics.py acquires the two sources and builds a
combined dataset. This module's CLI produces an Against-only audit.
"""
import argparse
from collections import Counter
import hashlib
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import re
from urllib.parse import parse_qs, urlparse

ROLES = dict(top='Top', jungle='Jungle', middle='Mid', bottom='ADC', support='Support')
COLUMNS = ['id', 'wr', 'd1', 'd2', 'pr', 'n']


class QwikHTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.blocks = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        if tag == 'script' and dict(attrs).get('type') == 'qwik/json':
            self.current = []

    def handle_data(self, value):
        if self.current is not None:
            self.current.append(value)

    def handle_endtag(self, tag):
        if tag == 'script' and self.current is not None:
            self.blocks.append(''.join(self.current))
            self.current = None


class References:
    """Decode only ordinary Qwik object references, never evaluate JS/functions."""
    def __init__(self, objects):
        self.objects = objects
        self.cache = {}

    def read(self, ref, active=frozenset()):
        if not isinstance(ref, str) or not re.fullmatch('[0-9a-z]+', ref):
            raise ValueError('Unsupported Qwik reference')
        index = int(ref, 36)
        if index >= len(self.objects) or index in active or len(active) > 30:
            raise ValueError('Invalid or cyclic Qwik reference')
        if index in self.cache:
            return self.cache[index]
        value = self.objects[index]
        active = active | {index}
        if isinstance(value, dict):
            value = {k: self.read(v, active) for k, v in value.items()}
        elif isinstance(value, list):
            value = [self.read(v, active) for v in value]
        self.cache[index] = value
        return value


def normalize_groups(groups, relation, candidate, candidate_lane, columns):
    """Normalize observed role tables. No inferred roles, symmetry or sample cutoff.

    Both relations use their observed explicit columns. This function does not
    fetch data, infer missing values or establish source usage permissions.
    """
    if relation not in ('vs', 'with') or candidate_lane not in ROLES:
        raise ValueError('Invalid relation or candidate role')
    if type(candidate) is not int or candidate <= 0:
        raise ValueError('Invalid candidate identity')
    if columns != COLUMNS or not isinstance(groups, dict) or not set(groups) <= set(ROLES):
        raise ValueError('Unknown source columns or roles')
    observations, rejected, seen = [], Counter(), set()
    counts = {}
    for lane, rows in groups.items():
        if not isinstance(rows, list):
            raise ValueError('Invalid opponent group')
        counts[lane] = len(rows)
        for row in rows:
            if not isinstance(row, list) or len(row) != len(COLUMNS):
                raise ValueError('Pair row schema changed')
            other, wr, d1, delta, pick, games = row
            if (type(other) is not int or other <= 0 or type(games) is not int or games < 0
                    or any(type(n) not in (int, float) or not math.isfinite(n) for n in (wr, d1, pick))
                    or (delta is not None and (type(delta) not in (int, float) or not math.isfinite(delta) or abs(delta) > 100))):
                raise ValueError('Invalid source observation')
            if (lane, other) in seen:
                raise ValueError('Duplicate directional observation')
            seen.add((lane, other))
            if other == candidate:
                rejected['self'] += 1
                continue
            if relation == 'with' and lane == candidate_lane:
                raise ValueError('Same-role synergy is not supported by the draft model')
            observations.append(dict(relation=relation, candidateChampionId=str(candidate),
                                     candidateRole=ROLES[candidate_lane], otherChampionId=str(other),
                                     otherRole=ROLES[lane], delta2=delta, games=games))
    return observations, counts, dict(rejected)


def inspect(raw, url):
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    if (parsed.scheme != 'https' or parsed.netloc != 'lolalytics.com'
            or not re.fullmatch('/lol/[a-z0-9]+/build/', parsed.path)
            or query.get('patch') != ['14'] or len(query.get('lane', [])) != 1
            or query['lane'][0] not in ROLES):
        raise ValueError('Require the observed public Build URL with explicit lane and patch=14')
    parser = QwikHTML()
    parser.feed(raw.decode('utf-8'))
    if len(parser.blocks) != 1:
        raise ValueError('Expected exactly one Qwik JSON block')
    objects = json.loads(parser.blocks[0])['objs']
    refs = References(objects)
    roots = [o for o in objects if isinstance(o, dict) and {'header', 'enemy_h', 'enemy', 'nav'} <= o.keys()]
    routes = [o for o in objects if isinstance(o, dict) and {'path', 'champion', 'mode', 'tier', 'region', 'patch', 'lane'} <= o.keys()]
    if len(roots) != 1 or len(routes) != 1:
        raise ValueError('Ambiguous or missing Build data/route')
    root, route = roots[0], routes[0]
    state = {k: refs.read(route[k]) for k in ('path', 'champion', 'mode', 'tier', 'region', 'patch', 'lane')}
    header = refs.read(root['header'])
    if (state != dict(path=parsed.path, champion=parsed.path.split('/')[2], mode='ranked',
                      tier='emerald_plus', region='all', patch='14', lane=query['lane'][0])
            or header['queue'] != 420 or header['lane'] != state['lane'] or header['patch'] != '14'):
        raise ValueError('Source filters do not match the observed URL/context')
    if refs.read(root['enemy_h']) != COLUMNS:
        raise ValueError('Against column schema changed; do not guess delta positions')
    groups = refs.read(root['enemy'])
    if set(groups) != set(ROLES):
        raise ValueError('Expected five explicit opponent roles')
    candidate = header['cid']
    if type(candidate) is not int or candidate <= 0:
        raise ValueError('Invalid candidate identity')
    observations, counts, rejected = normalize_groups(groups, 'vs', candidate, state['lane'], COLUMNS)
    return dict(schemaVersion=1, kind='experimental-public-html-audit', sourceUrl=url,
                sourceSha256=hashlib.sha256(raw).hexdigest(), observedContext=state,
                queueId=420, candidateChampionId=str(candidate), candidateRole=ROLES[state['lane']], columns=COLUMNS, sourceCounts=counts, rejected=dict(rejected),
                candidateLaneDistribution=refs.read(root['nav']),
                observations=observations, counts=dict(Counter(p['otherRole'] for p in observations)),
                zeroCount=sum(p['delta2'] == 0 for p in observations),
                nullCount=sum(p['delta2'] is None for p in observations),
                synergy='separate-build-team-response; use collect_lolalytics.py',
                publicationEligible=False,
                unresolved=['Against-only audit; combined exports are produced by collect_lolalytics.py'])


def verify_display(audit, rows, relation='vs'):
    """Compare independent rendered cells to source observations by relation and role."""
    catalogue = json.loads((Path(__file__).resolve().parents[2] / 'src/data/champions.json').read_text())
    ids = {c['name']: c['id'] for c in catalogue}
    index = {(p['otherRole'], p['otherChampionId']): p for p in audit['observations'] if p['relation'] == relation}
    expected = urlparse(audit['sourceUrl'])
    candidate_lane = parse_qs(expected.query)['lane']
    seen = set()
    if not isinstance(rows, list) or not rows:
        raise ValueError('No rendered observations to compare')
    for row in rows:
        link = urlparse(row['href'])
        query = parse_qs(link.query)
        if relation == 'vs':
            if (link.netloc or not re.fullmatch(expected.path.replace('/build/', '/vs/[a-z0-9]+/build/'), link.path)
                    or query.get('patch') != ['14'] or query.get('lane') != candidate_lane
                    or len(query.get('vslane', [])) != 1 or query['vslane'][0] not in ROLES):
                raise ValueError('Rendered matchup context differs from source')
            role = query['vslane'][0]
        elif relation == 'with':
            if (link.netloc or not re.fullmatch('/lol/[a-z0-9]+/build/', link.path)
                    or query.get('patch') != ['14'] or len(query.get('lane', [])) != 1
                    or query['lane'][0] not in ROLES or query['lane'] == candidate_lane):
                raise ValueError('Rendered synergy context differs from source')
            role = query['lane'][0]
        else:
            raise ValueError('Unknown rendered relation')
        key = (ROLES[role], ids.get(row['name']))
        if key not in index or key in seen or len(row['cells']) != 5:
            raise ValueError('Unknown, duplicate or malformed rendered observation')
        seen.add(key)
        observed = index[key]
        if (float(row['cells'][2]) != observed['delta2']
                or int(row['cells'][4].replace(',', '')) != observed['games']):
            raise ValueError('Rendered Delta 2/games differ from embedded values')
    return len(seen)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('html', type=Path)
    parser.add_argument('--url', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--display', type=Path, help='Independent rendered cell capture from the browser POC')
    args = parser.parse_args()
    result = inspect(args.html.read_bytes(), args.url)
    if args.display:
        result['renderedCompared'] = verify_display(result, json.loads(args.display.read_text()))
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: result[k] for k in ('sourceCounts', 'counts', 'zeroCount', 'publicationEligible')}))


if __name__ == '__main__':
    main()
