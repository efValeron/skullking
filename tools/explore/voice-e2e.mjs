// Voice input end-to-end on the clone with a fake SpeechRecognition (phrases are queued, not spoken).
// Usage: node voice-e2e.mjs [url]   (default http://localhost:5173/)
import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';

const URL_ = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, locale: 'ru-RU' });
await ctx.addInitScript(() => {
  // Queue items: { alts, final } — a result; 'END' — the browser stops by itself after a pause.
  window.__say = [];
  window.__starts = 0;
  class FakeRec {
    start() {
      window.__starts++;
      this.t = setInterval(() => {
        const x = window.__say.shift();
        if (!x) return;
        if (x === 'END') {
          clearInterval(this.t);
          return this.onend?.();
        }
        const res = Object.assign(x.alts.map((transcript) => ({ transcript })), { isFinal: x.final });
        this.onresult?.({ resultIndex: 0, results: [res] });
      }, 15);
    }
    stop() {
      clearInterval(this.t);
      setTimeout(() => this.onend?.(), 5);
    }
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
const mic = btn('Говорить');
const listening = async () => (await mic.getAttribute('aria-pressed')) === 'true';
const push = async (item) => {
  await page.evaluate((x) => window.__say.push(x), item);
  await page.waitForFunction(() => window.__say.length === 0);
  await page.waitForTimeout(60);
};
const say = (...alts) => push({ alts, final: true });
const partial = (text) => push({ alts: [text], final: false });
const text = (s) => page.getByText(s, { exact: false });
const value = (group) => page.getByRole('group', { name: group, exact: true }).locator('.stepper-value');
const ok = (m) => console.log('ok ', m);

// Names: the mic is in the app bar; names go straight into the fields, live and highlighted.
await btn('Начать новую игру').click();
const fields = () => page.locator('input.name-field').evaluateAll((els) => els.map((e) => e.value));
await mic.click();
assert.equal(await listening(), true);
await partial('Аня');
assert.deepEqual(await fields(), ['Аня', ''], 'filled while still speaking');
await say('Аня, Дима и Оля Иван');
assert.deepEqual(await fields(), ['Аня', 'Дима', 'Оля', 'Иван']);
assert.equal(await page.locator('input.name-field.voice-mark').count(), 4, 'voice fields highlighted');
await say('Катя, ходи уже');
assert.equal(await text('Не понял: «Катя, ходи уже»').count(), 1);
assert.deepEqual(await fields(), ['Аня', 'Дима', 'Оля', 'Иван'], 'noise changed nothing');
await btn('Вернуть как было').click();
assert.deepEqual(await fields(), ['', '']);
ok('names live into the fields, noise rejected, undo');

await say('Аня');
await say('Аня');
assert.equal(await text('такое имя уже есть').count(), 1);
await say('Дима Оля готово');
assert.deepEqual(await fields(), ['Аня', 'Дима', 'Оля']);
assert.equal(await listening(), false, 'stop word ends listening');
ok('duplicate rejected, «готово» stops the mic');

await btn('Новая игра').click();
await btn('Начать игру').click(); // 10 rounds, round 1 = 1 card

// Bids: a pause keeps the context, the browser's own stop is restarted, a later mention wins.
await mic.click();
await say('Аня');
await say('один');
assert.equal(await value('Аня').innerText(), '1', '«Аня» … pause … «один»');
assert.equal(await value('Аня').getAttribute('class'), 'stepper-value voice-mark');
const starts = await page.evaluate(() => window.__starts);
await push('END');
assert.equal(await page.evaluate(() => window.__starts), starts + 1, 'restarted after the browser stopped');
assert.equal(await listening(), true);
await say('Дима, у тебя два туза');
assert.equal(await text('Не понял и пропустил').count(), 1);
assert.equal(await value('Дима').innerText(), '0');
await say('Аня ноль');
assert.equal(await value('Аня').innerText(), '0', 'later mention wins');
await say('отмена');
assert.equal(await value('Аня').innerText(), '1', '«отмена» undoes the last phrase');
await say('всё');
assert.equal(await listening(), false);
assert.equal(await text('В игре 1 ставок из 1').count(), 1);
ok('bids: pause, restart, later wins, «отмена», «всё»');

// A manual edit starts over from the edited form: voice keeps it.
await page.getByRole('group', { name: 'Дима', exact: true }).getByRole('button', { name: 'Больше' }).click();
assert.equal(await page.locator('.stepper-value.voice-mark').count(), 0, 'manual edit clears the highlight');
await mic.click();
await say('Оля ноль');
assert.deepEqual(await Promise.all(['Аня', 'Дима', 'Оля'].map((n) => value(n).innerText())), ['1', '1', '0']);
await mic.click();
assert.equal(await listening(), false, 'second tap stops');
ok('manual edit kept by later voice');
await btn('Начать раунд').click();

// Results: written into the round at once; the sum and an ignored bonus show in the app bar.
await mic.click();
await partial('Аня ноль');
assert.equal(await value('Аня: Взято').innerText(), '0');
await say('Аня ноль');
assert.equal(await text('Сумма взяток 0, нужно 1').count(), 1);
assert.equal(await btn('Завершить раунд').isDisabled(), true);
await say('Дима один Аня бонус двадцать');
assert.equal(await value('Дима: Взято').innerText(), '1');
assert.equal(await value('Аня: Бонусы').innerText(), '20');
assert.equal(await text('бонус 20 не засчитается').count(), 1);
assert.equal(await btn('Завершить раунд').isEnabled(), true);
await say('стоп');
ok('results straight into the round, hints in the app bar');
await btn('Завершить раунд').click();
assert.deepEqual((await page.locator('td[data-round="1"] .total').allInnerTexts()).map(Number), [-10, 20, 10]);
ok('scores after voice round: -10, 20, 10');

// Round 2: Kraken by voice.
await btn('Следующий раунд').click();
await mic.click();
await say('Аня два всё');
await btn('Начать раунд').click();
await mic.click();
await say('кракен Аня один');
assert.equal(await page.getByLabel('Кракен').isChecked(), true);
assert.equal(await btn('Завершить раунд').isEnabled(), true);
ok('kraken by voice');

assert.deepEqual(errors, [], 'no page errors');
console.log('ALL OK');
await browser.close();
