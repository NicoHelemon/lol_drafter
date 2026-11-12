"""Capture a small public-page experiment, honoring robots and HTTP failures.

This is a discovery tool, NOT a proven Lolalytics Delta 2 extractor. Public URLs
must come from the displayed site. No private API endpoints or automatic retries.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time
from html.parser import HTMLParser
from urllib.error import URLError, HTTPError
from urllib.parse import urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.robotparser import RobotFileParser
from datetime import datetime, timezone

USER_AGENT = 'DraftroomResearch/0.1 (small public-page availability experiment)'
HOSTS = {'lolalytics.com', 'www.lolalytics.com'}


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never follow a redirect into a private API or another host.


class InspectHTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables = []
        self.scripts = []
        self._table = None
        self._row = None
        self._cell = None
        self._script = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'table':
            self._table = []
        elif tag == 'tr' and self._table is not None:
            self._row = []
        elif tag in ('td', 'th') and self._row is not None:
            self._cell = ''
        elif tag == 'script' and (attrs.get('type') in ('application/json', 'qwik/json') or attrs.get('id') == '__NEXT_DATA__'):
            self._script = {'id': attrs.get('id'), 'text': ''}

    def handle_data(self, data):
        if self._cell is not None:
            self._cell += data
        if self._script is not None:
            self._script['text'] += data

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self._cell is not None:
            self._row.append(' '.join(self._cell.split()))
            self._cell = None
        elif tag == 'tr' and self._row is not None:
            self._table.append(self._row)
            self._row = None
        elif tag == 'table' and self._table is not None:
            self.tables.append(self._table)
            self._table = None
        elif tag == 'script' and self._script is not None:
            self.scripts.append(self._script)
            self._script = None


def inspect(raw):
    parser = InspectHTML()
    parser.feed(raw.decode('utf-8', errors='replace'))
    scripts = []
    for script in parser.scripts:
        try:
            obj = json.loads(script['text'])
            scripts.append(dict(id=script['id'], bytes=len(script['text']),
                                rootKeys=list(obj)[:30] if isinstance(obj, dict) else [], validJSON=True))
        except ValueError:
            scripts.append(dict(id=script['id'], validJSON=False))
    return dict(tables=parser.tables, embeddedJSON=scripts,
                delta2LabelPresent=any(label in raw.lower() for label in (b'delta 2', b'delta2', b'delta%202')),
                verifiedObservations=0)  # Discovery isn't numerical verification.


def capture(url):
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname not in HOSTS or parsed.username or parsed.port:
        raise ValueError('Only public Lolalytics HTTPS pages are allowed')
    started = time.monotonic()
    try:
        with build_opener(NoRedirects).open(Request(url, headers={'User-Agent': USER_AGENT}), timeout=25) as response:
            raw = response.read(20_000_001)
            if len(raw) > 20_000_000:
                raise ValueError('Page exceeds the experiment size limit')
            return dict(url=url, status=response.status, bytes=len(raw),
                        sha256=hashlib.sha256(raw).hexdigest(),
                        seconds=round(time.monotonic() - started, 3)), raw
    except HTTPError as error:
        return dict(url=url, status=error.code, error=str(error)), None
    except (URLError, OSError) as error:
        return dict(url=url, status=None, error=str(error)), None


def probe(urls, destination):
    destination.mkdir(parents=True, exist_ok=True)
    report = dict(startedAt=datetime.now(timezone.utc).isoformat(), requests=[], verifiedObservations=0)
    for i, url in enumerate(urls):
        if i:
            time.sleep(1)  # Small experiment only, no retries/concurrency.
        report_item, raw = capture(url)
        report['requests'].append(report_item)
        if raw is not None:
            (destination / f'page-{i}.html').write_bytes(raw)
            report_item.update(inspect(raw))
        else:
            report['stopped'] = 'HTTP/network failure; no bypass or retries'
            break
        if urlparse(url).path == '/robots.txt':
            rules = RobotFileParser(url)
            rules.parse(raw.decode('utf-8').splitlines())
            if any(not rules.can_fetch(USER_AGENT, page) for page in urls[i + 1:]):
                report['stopped'] = 'robots.txt disallows at least one requested page'
                break
    (destination / 'report.json').write_text(json.dumps(report, indent=2))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', action='append', default=[], help='Exact public URL verified in the site UI')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if len(args.url) > 9:
        parser.error('Small POC: at most nine public pages')
    urls = ['https://lolalytics.com/robots.txt', *args.url]
    print(json.dumps(probe(urls, args.output), indent=2))


if __name__ == '__main__':
    main()
