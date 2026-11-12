/** Verify real Synergy via the site's normal UI. No auth or TLS bypass.
 * node scripts/statistics/verify_lolalytics_browser.mjs /tmp/live-synergy
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const output = process.argv[2];
if (!output) throw Error('Pass a capture directory');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route('**/*', route => ['lolalytics.com', 'a1.lolalytics.com'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
  for (const [slug, lane] of [['renekton', 'top'], ['ahri', 'middle'], ['jhin', 'bottom']]) {
    const buildUrl = `https://lolalytics.com/lol/${slug}/build/?lane=${lane}&patch=14`;
    const pending = page.waitForResponse(r => {
      const u = new URL(r.url());
      return u.hostname === 'a1.lolalytics.com' && u.searchParams.get('ep') === 'build-team'
        && u.searchParams.get('c') === slug && u.searchParams.get('lane') === lane
        && u.searchParams.get('patch') === '14' && u.searchParams.get('tier') === 'emerald_plus'
        && u.searchParams.get('queue') === 'ranked' && u.searchParams.get('region') === 'all';
    }, { timeout: 30000 });
    const html = await page.goto(buildUrl, { waitUntil: 'domcontentloaded' });
    if (html.status() !== 200 || page.url() !== buildUrl) throw Error('Unexpected Build response');
    await writeFile(resolve(output, `${slug}-build.html`), await html.body());
    await page.locator('[data-type=common_counter]').click();
    const team = await pending;
    if (team.status() !== 200) throw Error(`Synergy HTTP ${team.status()}`);
    await writeFile(resolve(output, `${slug}-team.json`), await team.body());
    await page.locator('[data-type=common_synergy]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('a[href*="/build/"]')].some(e =>
      e.parentElement.children.length === 6 && e.parentElement.firstElementChild === e &&
      /^[0-9.-]+$/.test(e.parentElement.children[1].textContent)), null, { timeout: 15000 });
    const rows = await page.locator('a[href*="/build/"]').evaluateAll(es => es.filter(e =>
      e.parentElement.children.length === 6 && e.parentElement.firstElementChild === e &&
      /^[0-9.-]+$/.test(e.parentElement.children[1].textContent)).map(e => ({
        href: e.getAttribute('href'), name: e.querySelector('span img')?.alt,
        cells: [...e.parentElement.children].slice(1).map(e => e.textContent),
      })));
    if (rows.length !== 76) throw Error(`Expected 19 cells in each of four roles; got ${rows.length}`);
    await writeFile(resolve(output, `${slug}-display.json`), JSON.stringify(rows, null, 2));
    await writeFile(resolve(output, `${slug}-network.json`), JSON.stringify({ buildUrl, teamUrl: team.url(),
      teamStatus: team.status(), capturedAt: new Date().toISOString() }, null, 2));
    await page.screenshot({ path: resolve(output, `${slug}-synergy.png`) });
    console.log(`${slug}: captured ${rows.length} real Synergy cells`);
  }
  execFileSync('python3', ['scripts/statistics/verify_lolalytics_capture.py', output], { stdio: 'inherit' });
} finally { await browser.close(); }
