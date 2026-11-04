// PWA check on a production build: manifest, service worker, works offline after the first visit.
// Usage: node pwa-check.mjs [url]   (default http://localhost:4173/ = `npx vite preview --port 4173`)
import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';

const APP = process.argv[2] ?? 'http://localhost:4173/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, locale: 'ru-RU' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const ok = (m) => console.log('ok ', m);

await page.goto(APP);
const manifest = await page.evaluate(async () => {
  const href = document.querySelector('link[rel=manifest]')?.getAttribute('href');
  return href && (await fetch(href)).json();
});
assert.equal(manifest?.display, 'standalone');
assert.ok(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'), 'maskable 512 icon');
for (const i of manifest.icons) assert.equal((await page.request.get(new URL(i.src, APP).href)).status(), 200, i.src);
ok(`manifest «${manifest.name}», ${manifest.icons.length} icons reachable`);

await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload(); // page is now controlled by the service worker
assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'controlled by SW');
ok('service worker active and controlling');

await ctx.setOffline(true);
await page.reload();
await page.getByRole('button', { name: 'Начать новую игру', exact: true }).click();
await page.getByLabel('Введите имя 1').fill('Аня');
await page.getByLabel('Введите имя 2').fill('Дима');
await page.getByRole('button', { name: 'Новая игра', exact: true }).click();
await page.getByRole('button', { name: 'Начать игру', exact: true }).click();
assert.equal(await page.getByRole('heading', { name: 'Ставки для раунда 1' }).count(), 1);
const font = await page.evaluate(() => document.fonts.check('16px Pangolin', 'Аня'));
assert.ok(font, 'Pangolin (cyrillic) available offline');
await page.reload();
assert.equal(await page.getByText('Раунд 1').count(), 1, 'saved game listed after offline reload');
ok('offline: app loads, plays, saves, font available');

assert.deepEqual(errors, [], 'no page errors');
console.log('ALL OK');
await browser.close();
