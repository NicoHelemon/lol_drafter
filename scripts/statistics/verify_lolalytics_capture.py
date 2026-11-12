"""Compare a real browser's Synergy cells to the exact JSON it received."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
from collect_lolalytics import parse_team
from inspect_lolalytics import inspect, verify_display
from pipeline import atomic_write, encoded


def verify_capture(directory):
    directory = Path(directory)
    pages = []
    for slug, lane in [('renekton', 'top'), ('ahri', 'middle'), ('jhin', 'bottom')]:
        source = json.loads((directory / f'{slug}-network.json').read_text())
        html = (directory / f'{slug}-build.html').read_bytes()
        team = (directory / f'{slug}-team.json').read_bytes()
        build_url = source['buildUrl']
        audit = inspect(html, build_url)
        candidate = {'renekton':58, 'ahri':103, 'jhin':202}[slug]
        pairs = parse_team(team, candidate, lane)
        rendered = json.loads((directory / f'{slug}-display.json').read_text())
        compared = verify_display(dict(sourceUrl=build_url, observations=pairs), rendered, 'with')
        pages.append(dict(champion=slug, role=lane, buildUrl=build_url, teamUrl=source['teamUrl'],
                          teamStatus=source['teamStatus'], teamSha256=hashlib.sha256(team).hexdigest(),
                          againstSourceSha256=hashlib.sha256(html).hexdigest(),
                          against=len(audit['observations']), synergy=len(pairs), comparedSynergyRows=compared,
                          synergyGroups=dict(Counter(p['otherRole'] for p in pairs)),
                          zeroSynergy=sum(p['delta2'] == 0 for p in pairs),
                          minGames=min(p['games'] for p in pairs),
                          samples=[r for i,r in enumerate(rendered) if i % 19 == 0]))
    result = dict(kind='live-browser-and-response-comparison', fictional=False, pages=pages,
                  comparedSynergyRows=sum(p['comparedSynergyRows'] for p in pages))
    atomic_write(directory / 'verified.json', encoded(result))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    print(json.dumps(verify_capture(parser.parse_args().directory), indent=2))
