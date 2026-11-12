"""Execute pinned upstream collectors against saved HTML and synthetic transports.

Optional review dependencies: requests, parsel, httpx (isolated venv recommended).
This harness NEVER permits socket connections. It neither vendors upstream code
nor fetches private API data. Synthetic API values are explicitly artificial.
"""
import argparse
import asyncio
import importlib.util
import json
from pathlib import Path
import socket
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'scripts/statistics'))
from inspect_lolalytics import inspect, normalize_groups, COLUMNS

PINS = dict(rabadon='848eb8a7274d488a5f54b68e282d255b7cbd9397',
            hextech='fed9bc6af990bc27cd40b81f406125bca2a42a8f')


def pin(path, name):
    revision = subprocess.check_output(['git', '-C', str(path), 'rev-parse', 'HEAD'], text=True).strip()
    if revision != PINS[name]:
        raise ValueError(f'{name}: expected the reviewed commit {PINS[name]}')


def deny_network(*args, **kwargs):
    raise RuntimeError('No network permitted in collector comparison')


async def rabadon_experiment(repo):
    sys.path.insert(0, str(repo / 'backend'))
    from services import scraper
    from services.lolalytics_client import LolalyticsClient
    import httpx
    requests = []

    def transport(request):
        requests.append(dict(request.url.params))
        if request.url.params['ep'] == 'counter':
            lane = request.url.params['vslane']
            # Same ID in distinct roles, deliberately different d2/games.
            return httpx.Response(200, json={'stats': {'wr': 50}, 'counters': [
                {'cid': 64, 'd2': 2.5 if lane == 'jungle' else -1.5, 'n': 7 if lane == 'jungle' else 19}]})
        return httpx.Response(200, json={'team': {'middle': [[103, 51, 1, 1.25, 2, 3]]}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
        client = LolalyticsClient(http_client=http)
        with patch.object(scraper, 'get_client', return_value=client), patch.object(scraper, 'db'):
            counters, team, _ = await scraper._fetch_matchup_live('renekton', 'renekton', 'top', '14', 'emerald_plus', 'emerald_plus', 0)
        assert len(requests) == 6
        assert len({(r['cid'], r['query_vslane']) for r in counters}) == 5
        assert all(r['queue'] == 'ranked' and r['patch'] == '14' for r in requests)

    # Serve synthetic data only from memory; prohibit DB, network and refresh.
    memory = {'emerald_plus:14:renekton:top': dict(counters=counters, team=team, win_rate=50)}
    with patch.object(scraper, '_ensure_champion_map', new=AsyncMock()), \
            patch.object(scraper, '_matchup_mem_cache', memory), \
            patch.object(scraper, '_slug_to_id', {'leesin': 64, 'ahri': 103}), \
            patch.object(scraper, '_is_stale', return_value=False), \
            patch.object(scraper, 'get_champion_total_games', new=AsyncMock(return_value=42)):
        exact = await scraper.get_matchup_data('Renekton', 'top', [{'champion': 'Ahri', 'role': 'mid'}],
                                               [{'champion': 'Lee Sin', 'role': 'jungle'}], patch='14')
        missing = await scraper.get_matchup_data('Renekton', 'top', [{'champion': 'Ahri', 'role': 'support'}], [], patch='14')
    assert exact[0][('lee sin', 'enemy')] == .025
    assert exact[0][('ahri', 'ally')] == .0125
    # Reproduces a role fallback incompatible with this application's strict tuple keys.
    assert missing[0][('ahri', 'ally')] == .0125
    normalized, _, _ = normalize_groups(team, 'with', 58, 'top', COLUMNS)
    assert normalized[0]['delta2'] == 1.25 and normalized[0]['games'] == 3
    assert not any(r['otherRole'] == 'Support' for r in normalized)
    return dict(kind='synthetic-only', networkConnections=0, requestsSimulated=requests,
                exactEnemyFraction=exact[0][('lee sin', 'enemy')],
                exactSynergyFraction=exact[0][('ahri', 'ally')],
                missingSupportIncorrectlyFallsBackToMid=True,
                localNormalizerKeepsPointsAndExactRoles=True)


def hextech_experiment(repo, pages):
    spec = importlib.util.spec_from_file_location('reviewed_hextech', repo / 'projects/counterpick-coverage/build.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    catalogue = json.loads((ROOT / 'src/data/champions.json').read_text())
    roster = {int(c['id']): dict(slug=c['id'], name=c['name']) for c in catalogue}
    report = []
    for i, (champion, lane) in enumerate([('renekton', 'top'), ('ahri', 'middle'), ('jhin', 'bottom')]):
        build = pages / f'page-{1 + 2*i}.html'
        counters = pages / f'page-{2 + 2*i}.html'
        url = f'https://lolalytics.com/lol/{champion}/build/?lane={lane}&patch=14'
        audit = inspect(build.read_bytes(), url)
        args = SimpleNamespace(lane=lane, tier='emerald_plus', period='14')
        result = module.extract_matchup_page(counters.read_text(), dict(slug=champion, name=champion.title()),
                                            roster, args, f'https://lolalytics.com/lol/{champion}/counters/?lane={lane}&vslane={lane}&patch=14')
        role = dict(top='Top', middle='Mid', bottom='ADC')[lane]
        expected = {r['otherChampionId']: r for r in audit['observations'] if r['otherRole'] == role}
        matches, differences = 0, []
        for cid, row in result['matchups'].items():
            other = expected.get(cid)
            if other and (row['delta_2'], row['games']) == (other['delta2'], other['games']):
                matches += 1
            else:
                differences.append(dict(otherId=cid, counterDelta2=row['delta_2'], counterGames=row['games'],
                                        buildDelta2=other and other['delta2'], buildGames=other and other['games']))
        report.append(dict(champion=champion, counterRows=len(result['matchups']),
                           buildRowsAllRoles=len(audit['observations']), buildRowsSameRole=len(expected),
                           counterBuildExactMatches=matches, differences=differences,
                           sourceOnlyBelow100=sum(r['games'] < 100 for r in audit['observations'])))
        # This parser is deliberately same-lane: changing the expected lane must fail.
        try:
            module.extract_matchup_page(counters.read_text(), dict(slug=champion, name=champion.title()), roster,
                                        SimpleNamespace(lane='support', tier='emerald_plus', period='14'), 'unused')
        except module.ScrapeError:
            pass
        else:
            raise AssertionError('Hextech unexpectedly accepted a mismatched role')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rabadon', type=Path, required=True)
    parser.add_argument('--hextech', type=Path, required=True)
    parser.add_argument('--pages', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    pin(args.rabadon, 'rabadon'); pin(args.hextech, 'hextech')
    with patch.object(socket.socket, 'connect', deny_network), patch.object(socket, 'create_connection', deny_network):
        result = dict(revisions=PINS, networkConnections=0,
                      rabadon=asyncio.run(rabadon_experiment(args.rabadon)),
                      hextech=hextech_experiment(args.hextech, args.pages))
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
