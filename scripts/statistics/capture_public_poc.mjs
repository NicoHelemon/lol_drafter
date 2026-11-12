/** Limited public-page verification. No private API, retries or publication.
 * Node 24; Chromium must trust the environment proxy CA (never disable TLS).
 * Usage: node scripts/statistics/capture_public_poc.mjs /tmp/public-poc
 * The output directory contains research captures, not production datasets.
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = process.argv[2];
if (!output) throw Error('Pass an output directory');
await mkdir(output, { recursive: true });
const targets = [['renekton', 'top'], ['ahri', 'middle'], ['jhin', 'bottom']];
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  // Abort before the network, including automatic build-team requests. No API bypass.
  await page.route('**/*', route => new URL(route.request().url()).hostname === 'lolalytics.com'
    ? route.continue() : route.abort('blockedbyclient'));
  const robotsResponse = await page.goto('https://lolalytics.com/robots.txt', { waitUntil: 'domcontentloaded' });
  if (robotsResponse.status() !== 200) throw Error('robots.txt unavailable');
  const robots = await robotsResponse.body();
  await writeFile(resolve(output, 'robots.txt'), robots);
  const urls = targets.map(([c, lane]) => `https://lolalytics.com/lol/${c}/build/?lane=${lane}&patch=14`);
  execFileSync('python3', ['-c', `
import sys
from urllib.robotparser import RobotFileParser
p=RobotFileParser(); p.parse(sys.stdin.read().splitlines())
if not all(p.can_fetch(sys.argv[1], u) for u in sys.argv[2:]):
    raise SystemExit('robots.txt disallows a target for this browser user agent')
`, await page.evaluate(() => navigator.userAgent), ...urls], { input: robots });
  for (const [i, [champion]] of targets.entries()) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const requests = [];
    const responses = [];
    const failures = [];
    const onRequest = r => requests.push({ url: r.url(), type: r.resourceType(),
      blockedBeforeNetwork: new URL(r.url()).hostname !== 'lolalytics.com' });
    const onResponse = r => responses.push({ url: r.url(), status: r.status() });
    const onFailure = r => failures.push({ url: r.url(), error: r.failure()?.errorText });
    page.on('request', onRequest); page.on('response', onResponse); page.on('requestfailed', onFailure);
    const response = await page.goto(urls[i], { waitUntil: 'domcontentloaded' });
    if (response.status() !== 200 || page.url() !== urls[i]) throw Error('Unexpected response or redirect');
    const htmlPath = resolve(output, `${champion}.html`);
    await writeFile(htmlPath, await response.body());
    await page.locator('[data-type=common_counter]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('a[href*="/vs/"]')].some(e =>
      e.parentElement.children.length === 6 && e.parentElement.firstElementChild === e &&
      /^[0-9.-]+$/.test(e.parentElement.children[1].textContent)), null, { timeout: 15000 });
    const rows = await page.locator('a[href*="/vs/"]').evaluateAll(es => es.filter(e =>
      e.parentElement.children.length === 6 && e.parentElement.firstElementChild === e &&
      /^[0-9.-]+$/.test(e.parentElement.children[1].textContent)).map(e => ({
        href: e.getAttribute('href'), name: e.querySelector('span img')?.alt,
        cells: [...e.parentElement.children].slice(1).map(e => e.textContent),
      })));
    await writeFile(resolve(output, `${champion}-rendered.html`), await page.content());
    await writeFile(resolve(output, `${champion}-display.json`), JSON.stringify(rows, null, 2));
    await page.screenshot({ path: resolve(output, `${champion}.png`) });
    page.off('request', onRequest); page.off('response', onResponse); page.off('requestfailed', onFailure);
    await writeFile(resolve(output, `${champion}-network.json`), JSON.stringify({ requests, responses, failures }, null, 2));
    execFileSync('python3', ['scripts/statistics/inspect_lolalytics.py', htmlPath,
      '--url', urls[i], '--display', resolve(output, `${champion}-display.json`), '--output', resolve(output, `${champion}-audit.json`)], { stdio: 'inherit' });
    console.log(`${champion}: ${rows.length} rendered Against rows; all external hosts blocked before network`);
  }
} finally {
  await browser.close();
}
