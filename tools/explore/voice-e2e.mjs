// Voice input end-to-end on the clone with a fake SpeechRecognition (phrases are queued, not spoken).
// Usage: node voice-e2e.mjs [url]   (default http://localhost:5173/)
import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';

const URL_ = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, locale: 'ru-RU' });
await ctx.addInitScript(() => {
  window.__say = [];
  class FakeRec {
    start() {
      const alts = window.__say.shift() ?? [];
      setTimeout(() => {
        if (alts.length) {
          const res = Object.assign(alts.map((transcript) => ({ transcript })), { isFinal: true });
          this.onresult?.({ resultIndex: 0, results: [res] });
        } else this.onerror?.({ error: 'no-speech' });
        this.onend?.();
      }, 20);
    }
    stop() {}
  }
  window.SpeechRecognition = FakeRec;
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(URL_);
await page.evaluate(() => localStorage.clear());
await page.reload();

const btn = (name) => page.getByRole('button', { name, exact: true });
const say = async (...alts) => {
  await page.evaluate((a) => window.__say.push(a), alts);
  await page.getByRole('button', { name: /^(Говорить|Слушаю)/ }).click();
  await page.waitForTimeout(80);
};
const text = (s) => page.getByText(s, { exact: false });
const value = (group) => page.getByRole('group', { name: group, exact: true }).locator('.stepper-value').innerText();
const ok = (m) => console.log('ok ', m);

// Names: one phrase = one name; noise and duplicates rejected; a third name adds a row.
await btn('Начать новую игру').click();
await say('Аня');
await say('Дима');
await say('Аня два');
assert.equal(await text('Не понял: «Аня два»').count(), 1);
await say('Аня');
assert.equal(await text('такое имя уже есть').count(), 1);
await say('Оля');
assert.deepEqual(await page.locator('input.name-field').evaluateAll((els) => els.map((e) => e.value)), ['Аня', 'Дима', 'Оля']);
ok('names by voice, noise and duplicate rejected');
await btn('Вернуть как было').click();
assert.equal(await page.locator('input.name-field').count(), 2);
await say('Оля');
ok('undo last name');

await btn('Новая игра').click();
await btn('Начать игру').click(); // 10 rounds, round 1 = 1 card

// Bids: draft with default zeros, noise doesn't break it, «принять» by voice.
await say('Аня один');
assert.equal(await text('Оля 0 (по умолчанию)').count(), 1);
await say('Дима, у тебя два туза');
assert.equal(await text('Не понял').count(), 1);
assert.equal(await value('Аня'), '0', 'nothing applied before accept');
await say('принять');
assert.equal(await value('Аня'), '1');
assert.equal(await text('В игре 1 ставок из 1').count(), 1);
ok('bids draft → accept by voice');
await btn('Вернуть как было').click();
assert.equal(await value('Аня'), '0');
await say('Аня один');
await btn('Принять').click();
assert.equal(await value('Аня'), '1');
ok('bids undo and accept by tap');
await btn('Начать раунд').click();

// Results: sum mismatch blocks accept; parts merge; bonus warning.
await say('Аня ноль');
assert.equal(await btn('Принять').isDisabled(), true);
assert.equal(await text('Сумма взяток 0, нужно 1').count(), 1);
await say('Дима один Аня бонус двадцать');
assert.equal(await btn('Принять').isEnabled(), true);
assert.equal(await text('бонус 20 не засчитается').count(), 1);
assert.equal(await value('Дима: Взято'), '0', 'nothing applied before accept');
await btn('Принять').click();
assert.equal(await value('Дима: Взято'), '1');
assert.equal(await value('Аня: Бонусы'), '20');
assert.equal(await btn('Завершить раунд').isEnabled(), true);
ok('results: block on mismatch, merge parts, accept');
await btn('Завершить раунд').click();
assert.deepEqual((await page.locator('td[data-round="1"] .total').allInnerTexts()).map(Number), [-10, -10, 10]);
ok('scores after voice round: -10, -10, 10');

// Round 2: Kraken by voice.
await btn('Следующий раунд').click();
await say('Аня два');
await say('принять');
await btn('Начать раунд').click();
await say('кракен Аня один');
await say('принять');
assert.equal(await page.getByLabel('Кракен').isChecked(), true);
assert.equal(await btn('Завершить раунд').isEnabled(), true);
ok('kraken by voice');

assert.deepEqual(errors, [], 'no page errors');
console.log('ALL OK');
await browser.close();
