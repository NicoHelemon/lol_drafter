"""Unofficial Lolalytics collector: public Build HTML + website build-team JSON.

Uses ordinary HTTPS with inherited proxy/TLS trust, no authentication bypass.
Source API carries a restrictive third-party usage notice; this program does not
claim a data license. Runs locally; publication is a separate existing command.
One central snapshot, never a source request per room/pick. No sample thresholds.
"""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import threading
from datetime import datetime, timezone
import gzip
import hashlib
from http.client import IncompleteRead
import json
from pathlib import Path
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, build_opener
from urllib.robotparser import RobotFileParser

from inspect_lolalytics import inspect, QwikHTML, References, ROLES, normalize_groups, COLUMNS
from pipeline import CONTEXT, ROOT, atomic_write, build, encoded, verify
from probe import NoRedirects

HOSTS = {'lolalytics.com', 'a1.lolalytics.com'}
USER_AGENT = 'DraftroomResearch/0.2 (pairwise statistics; sequential cached requests)'


def urls(slug, lane):
    query = dict(lane=lane, patch='14')
    return (f'https://lolalytics.com/lol/{slug}/build/?{urlencode(query)}',
            'https://a1.lolalytics.com/mega/?' + urlencode(dict(
                ep='build-team', v='1', patch='14', c=slug, lane=lane,
                tier='emerald_plus', queue='ranked', region='all')))


def parse_team(raw, candidate, lane):
    data = json.loads(raw)
    if (not isinstance(data, dict) or not isinstance(data.get('response'), dict)
            or data['response'].get('valid') is not True
            or data.get('team_h') != COLUMNS or not isinstance(data.get('team'), dict)
            or set(data['team']) != set(ROLES) - {lane}):
        raise ValueError('Invalid or changed build-team response/schema/role groups')
    pairs, _, _ = normalize_groups(data['team'], 'with', candidate, lane, data['team_h'])
    return pairs


def catalogue_map(raw):
    parser = QwikHTML(); parser.feed(raw.decode())
    if len(parser.blocks) != 1:
        raise ValueError('Expected a public Qwik champion registry')
    objects = json.loads(parser.blocks[0])['objs']; refs = References(objects)
    registries = [o for o in objects if isinstance(o, dict) and {'champPath', 'champId'} <= o.keys()]
    if len(registries) != 1:
        raise ValueError('Ambiguous champion registry')
    paths = refs.read(registries[0]['champPath'])
    local = json.loads((ROOT / 'src/data/champions.json').read_text())
    result = {}
    import re
    for champion in local:
        slug = paths.get(champion['id'])
        if not isinstance(slug, str) or not re.fullmatch('[a-z0-9]+', slug):
            raise ValueError(f"Missing verified source slug for champion {champion['id']}")
        if slug in result:
            raise ValueError('Duplicate source slug')
        result[slug] = int(champion['id'])
    return result


class Fetcher:
    def __init__(self, directory, interval=1.0):
        if interval < .5:
            raise ValueError('Interval must be >= 0.5 seconds')
        self.directory = Path(directory); self.directory.mkdir(parents=True, exist_ok=True)
        self.interval = interval; self.last_started = 0.; self.network_requests = 0
        self.rate_lock = threading.Lock()
        self.cooldown_until = 0.
        self.opener = build_opener(NoRedirects)
        self.rules = {}

    def get(self, url):
        parsed = urlparse(url)
        if parsed.scheme != 'https' or parsed.netloc not in HOSTS:
            raise ValueError('Unexpected collection destination')
        if parsed.path != '/robots.txt':
            if parsed.netloc not in self.rules:
                raw, _ = self.get(f'https://{parsed.netloc}/robots.txt')
                rules = RobotFileParser(); rules.parse(raw.decode().splitlines())
                self.rules[parsed.netloc] = rules
            if not self.rules[parsed.netloc].can_fetch(USER_AGENT, url):
                raise ValueError('Source robots.txt disallows this URL')
        key = hashlib.sha256(url.encode()).hexdigest()
        record_path = self.directory / f'{key}.json'
        body_path = self.directory / f'{key}.gz'
        if record_path.exists():
            record = json.loads(record_path.read_text())
            raw = gzip.decompress(body_path.read_bytes())
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(record['fetchedAt'])).total_seconds()
            if record['url'] != url or hashlib.sha256(raw).hexdigest() != record['sha256']:
                raise ValueError('Acquisition cache corrupted; refusing silent replacement')
            if age < -300 or age > 48 * 3600:
                raise ValueError('Acquisition cache older than 48h; use a new run directory')
            return raw, record
        for attempt in range(3):
            with self.rate_lock:
                time.sleep(max(0., self.interval - (time.monotonic() - self.last_started),
                               self.cooldown_until - time.monotonic()))
                self.last_started = time.monotonic(); self.network_requests += 1
            try:
                with self.opener.open(Request(url, headers={'User-Agent': USER_AGENT}), timeout=30) as response:
                    if response.status != 200:
                        raise ValueError('Unexpected HTTP status')
                    raw = response.read(10_000_001)
                    if len(raw) > 10_000_000:
                        raise ValueError('Source response exceeds 10 MB')
                    record = dict(url=url, status=response.status, bytes=len(raw),
                                  sha256=hashlib.sha256(raw).hexdigest(),
                                  fetchedAt=datetime.now(timezone.utc).isoformat(),
                                  httpDate=response.headers.get('Date'),
                                  contentType=response.headers.get('Content-Type'))
                atomic_write(body_path, gzip.compress(raw, mtime=0))
                atomic_write(record_path, encoded(record))
                return raw, record
            except HTTPError as error:
                if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                    raise
                retry = error.headers.get('Retry-After', '')
                if retry:
                    from email.utils import parsedate_to_datetime
                    try:
                        delay = float(retry)
                    except ValueError:
                        delay = (parsedate_to_datetime(retry) - datetime.now(timezone.utc)).total_seconds()
                    if delay > 60:
                        raise RuntimeError(f'Rate limited; retry after {delay:.0f}s using the same run directory') from error
                    with self.rate_lock:
                        self.cooldown_until = max(self.cooldown_until, time.monotonic() + max(0, delay))
                else:
                    with self.rate_lock:
                        self.cooldown_until = max(self.cooldown_until, time.monotonic() + 2 ** attempt)
            except (URLError, TimeoutError, IncompleteRead, ConnectionError):
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)
        raise RuntimeError('Unreachable')


def collect(directory, all_candidates=False, candidates=None, interval=1., fetcher=None, workers=2):
    directory = Path(directory); directory.mkdir(parents=True, exist_ok=True)
    fetcher = fetcher or Fetcher(directory / 'responses', interval)
    seed_url = urls('renekton', 'top')[0]
    seed, _ = fetcher.get(seed_url)
    registry = catalogue_map(seed)
    targets = ([(slug, lane) for slug in sorted(registry) for lane in ROLES]
               if all_candidates else [tuple(value.split(':')) for value in candidates or []])
    if not targets or len(targets) != len(set(targets)):
        raise ValueError('Expected a nonempty unique target list')
    if any(slug not in registry or lane not in ROLES for slug, lane in targets):
        raise ValueError('Unknown champion slug or lane')
    run_path = directory / 'acquisition.json'
    if run_path.exists():
        report = json.loads(run_path.read_text())
        if report['targets'] != [list(t) for t in targets] or report['context'] != CONTEXT:
            raise ValueError('Resume requires exactly the same targets/context')
        if report.get('finishedAt'):
            verify(directory / 'snapshots' / report['snapshotId'])
            return report
    else:
        report = dict(startedAt=datetime.now(timezone.utc).isoformat(), context=CONTEXT,
                      targets=[list(t) for t in targets], completed={},
                      source='Lolalytics unofficial: public Build HTML + website build-team JSON')
    if workers not in (1, 2):
        raise ValueError('At most two concurrent source requests')
    if isinstance(fetcher, Fetcher):
        for host in HOSTS:
            if host not in fetcher.rules:
                robots, _ = fetcher.get(f'https://{host}/robots.txt')
                rules = RobotFileParser(); rules.parse(robots.decode().splitlines())
                fetcher.rules[host] = rules
    all_pairs = []
    stop = threading.Event()
    failures = []
    def collect_target_data(target):
        slug, lane = target
        build_url, team_url = urls(slug, lane)
        raw, html_record = fetcher.get(build_url)
        audit = inspect(raw, build_url)
        if audit['candidateChampionId'] != str(registry[slug]):
            raise ValueError('Candidate identity differs from registry')
        team_raw, team_record = fetcher.get(team_url)
        synergy = parse_team(team_raw, registry[slug], lane)
        pairs = audit['observations'] + synergy
        return slug, lane, pairs, html_record, team_record,audit.get('roleStatistics')
    def collect_target(target):
        if stop.is_set():
            # Do not raise the same exception instance in hundreds of queued
            # futures: that grows a shared traceback and hides the first cause.
            raise RuntimeError('Collection stopped after a source error') from failures[0]
        try:
            return collect_target_data(target)
        except Exception as error:
            failures.append(error); stop.set()
            raise
    pool = ThreadPoolExecutor(max_workers=workers)
    catalogue_rows=[]
    try:
        for index, result in enumerate(pool.map(collect_target, targets), 1):
            slug, lane, pairs, html_record, team_record,role_stats = result
            if role_stats is not None:catalogue_rows.append(role_stats)
            all_pairs.extend(pairs)
            counts = dict(Counter(p['relation'] for p in pairs))
            report['completed'][f'{registry[slug]}:{ROLES[lane]}'] = dict(
                counts=counts, zero=sum(p['delta2'] == 0 for p in pairs),
                below100=sum(p['games'] < 100 for p in pairs), sources=[html_record, team_record])
            atomic_write(run_path, encoded(report))
            print(f'{index}/{len(targets)} {slug}:{lane} vs={counts.get("vs", 0)} with={counts.get("with", 0)}', flush=True)
    finally:
        pool.shutdown(wait=True, cancel_futures=True)
    finished = datetime.now(timezone.utc).isoformat()
    # Never advance the local snapshot pointer until all requested candidates validate.
    document = dict(id='lolalytics-' + report['startedAt'], patch='14d', tier='Emerald+',
                    source=report['source'], importedAt=finished, fictional=False,
                    context=CONTEXT, pairs=all_pairs)
    if all_candidates and len(catalogue_rows)!=len(targets):
        raise ValueError('Incomplete role catalogue; current snapshot preserved')
    if catalogue_rows:
        from role_catalogue import document as role_document
        document['roleCatalogue']=role_document(catalogue_rows,finished)
    manifest = build(document, directory / 'snapshots')
    atomic_write(directory / 'dataset.json', encoded(document))
    report.update(finishedAt=finished, snapshotId=manifest['metadata']['snapshotId'],
                  pairCount=manifest['pairCount'], coverage=manifest['coverage'],
                  networkRequestsThisInvocation=fetcher.network_requests)
    atomic_write(run_path, encoded(report))
    verify(directory / 'snapshots' / report['snapshotId'])
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    targets = parser.add_mutually_exclusive_group(required=True)
    targets.add_argument('--all', action='store_true', help='All local champions × all five roles, no thresholds')
    targets.add_argument('--candidate', action='append', help='Exact source slug:lane, e.g. renekton:top')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--interval', type=float, default=1.0)
    parser.add_argument('--workers', type=int, choices=(1, 2), default=2)
    args = parser.parse_args()
    result = collect(args.output, args.all, args.candidate, args.interval, workers=args.workers)
    print(json.dumps({k:result[k] for k in ('snapshotId', 'pairCount', 'coverage')}, indent=2))


if __name__ == '__main__':
    main()
