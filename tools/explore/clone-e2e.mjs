// Replays the game played in the original on 2026-11-04 (docs/original-ux.md §4) on the clone
// and checks the running totals. Usage: node clone-e2e.mjs [url]   (default http://localhost:5173/)
import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';

const URL = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, locale: 'ru-RU' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(URL);

const btn = (name) => page.getByRole('button', { name, exact: true });
const preset = (name) => page.getByRole('button', { name: new RegExp(`^${name} \\+\\d+$`) }); // «Лут +20»
const group = (name) => page.getByRole('group', { name, exact: true });
const plus = async (g, n = 1) => { for (let i = 0; i < n; i++) await group(g).getByRole('button', { name: '+' }).click(); };
const minus = async (g, n = 1) => { for (let i = 0; i < n; i++) await group(g).getByRole('button', { name: '-' }).click(); };
const menu = () => btn('Открыть меню навигации').click();
const dealer = () => page.locator('.player-name:has(.dealer-mark):visible').innerText();
const totals = (round) => page.locator(`td[data-round="${round}"] .total`).allInnerTexts();
async function expectTotals(round, want) {
  assert.deepEqual((await totals(round)).map(Number), want, `totals of round ${round}`);
  console.log(`ok  round ${round} totals ${want.join(', ')}`);
}

// Players and options
await btn('Начать новую игру').click();
await btn('Добавить игрока').click();
for (const [i, n] of ['Аня', 'Дима', 'Оля'].entries()) await page.getByLabel(`Введите имя ${i + 1}`).fill(n);
await btn('Раздаёт: 3').click(); // Оля deals first
await btn('Новая игра').click();
await minus('Раунды', 6);
await btn('Начать игру').click();

// Round 1
assert.equal(await dealer(), 'Оля', 'round 1 dealer = the one picked');
await plus('Аня');
await btn('Начать раунд').click();
await plus('Аня: Взято');
await btn('Аня: ★').click();
await preset('Бонус для 14 карты').click();
await btn('Аня: ★').click();
await preset('Лут').click();
await minus('Аня: Бонусы'); // 10 + 20 − 10 = 20
await plus('Дима: Бонусы');
await btn('Завершить раунд').click();
await expectTotals(1, [40, 20, 10]);

// Round 2: Аня misses with a bonus, Оля makes 0 with a bonus
await btn('Следующий раунд').click();
assert.equal(await dealer(), 'Аня', 'round 2 dealer (wraps around)');
await plus('Аня', 2);
await plus('Дима');
await btn('Начать раунд').click();
await plus('Аня: Взято');
await plus('Аня: Бонусы', 2);
await plus('Дима: Взято');
await plus('Оля: Бонусы', 3);
await btn('Завершить раунд').click();
await expectTotals(2, [30, 40, 60]);

// Round 3: reset once via the menu, then Kraken (tricks = cards − 1)
await btn('Следующий раунд').click();
assert.equal(await dealer(), 'Дима', 'round 3 dealer');
await plus('Дима', 2);
await btn('Начать раунд').click();
await menu();
await btn('Начать раунд заново').click();
await btn('Да').click();
assert.equal(await page.getByText('В игре 0 ставок из 3').count(), 1, 'reset returns to bids with zeros');
console.log('ok  reset round');
await plus('Дима', 2);
await plus('Оля', 2);
await btn('Начать раунд').click();
await plus('Аня: Взято');
await plus('Дима: Взято');
assert.equal(await btn('Завершить раунд').isDisabled(), true, 'without Kraken 2 of 3 is not enough');
await page.getByLabel('Кракен').check();
assert.equal(await btn('Завершить раунд').isEnabled(), true, 'with Kraken 2 of 3 is enough');
console.log('ok  kraken rule');
await btn('Завершить раунд').click();
await expectTotals(3, [0, 30, 40]);

// Round 4: Оля leaves
await btn('Следующий раунд').click();
await menu();
await btn('Редактировать игроков').click();
await page.getByLabel('В игре: 3').uncheck();
await btn('Сохранить').click();
assert.equal(await dealer(), 'Аня', 'round 4: Оля is out, the mark skips her');
console.log('ok  dealer skips a player who left');
await plus('Аня', 2);
await plus('Дима', 2);
await btn('Начать раунд').click();
await plus('Аня: Взято', 2);
await plus('Дима: Взято', 2);
await btn('Аня: ★').click();
await preset('Русалка побила Черного Пирата').click();
await btn('Завершить раунд').click();
await expectTotals(4, [80, 70, 40]); // the original shows «-» for Оля here (deliberate fix)
assert.equal(await btn('Начать новую игру').count(), 1, 'finished game offers a new game');

// Edit round 2: Аня 2/0, Дима 1/2
await menu();
await btn('Редактировать очки за раунды').click();
await btn('Аня 2').click();
await minus('Взято');
await btn('Применить').click();
assert.equal(await page.getByText('В 2 раунде взято 1 ставок из 2').count(), 1, 'error for invalid round');
assert.equal(await btn('Сохранить').isDisabled(), true, 'save blocked while invalid');
await btn('Дима 2').click();
await plus('Взято');
await btn('Применить').click();
await btn('Сохранить').click();
await expectTotals(2, [20, 10, 60]);
await expectTotals(4, [70, 40, 40]);

// Persistence: reload shows the finished game in the list
await page.reload();
assert.equal(await page.getByText('Игра завершена').count(), 1);
assert.equal(await btn('Результаты').count(), 1);
console.log('ok  saved game listed after reload');

// ---------- Part 2: 7 players, deck limit, start round, modals, Back, Continue ----------
await page.evaluate(() => localStorage.clear());
await page.reload();
await btn('Начать новую игру').click();
for (let i = 0; i < 5; i++) await btn('Добавить игрока').click();
for (const [i, n] of ['Аня', 'Дима', 'Оля', 'Иван', 'Игорь', 'Андрей', 'Катя'].entries()) await page.getByLabel(`Введите имя ${i + 1}`).fill(n);
await btn('Новая игра').click();
await plus('Раунды');
await plus('Начать с раунда', 8);
assert.equal(await page.getByText('требуется 77 карт').count(), 1, 'deck warning');
assert.equal(await page.getByText('до 10, тогда потребуется 70 карт').count(), 1, 'default limit');
await btn('Начать игру').click(); // limit stepper untouched: must still apply (fix of original bug)

assert.equal(await page.locator('.grid2').count(), 1, '6+ players → 2-column bids');
await plus('Аня');
await menu();
await btn('Редактировать игроков').click();
await btn('Закрыть').click();
await menu();
await btn('Редактировать параметры игры').click();
await page.goBack(); // browser Back closes the modal
assert.equal(await page.getByText('В игре 1 ставок из 9').count(), 1, 'unsaved bid survives modals and Back');
console.log('ok  bids draft survives modals, Back closes modal');
await page.goBack(); // Back on a root screen does nothing
assert.equal(await page.getByRole('heading', { name: 'Ставки для раунда 9' }).count(), 1, 'Back on root stays');
console.log('ok  Back on root screen stays');

await btn('Начать раунд').click();
await plus('Аня: Взято', 9);
await btn('Завершить раунд').click();
await btn('Следующий раунд').click();
await btn('Начать раунд').click();
await plus('Дима: Взято', 10);
await btn('Завершить раунд').click();
assert.equal(await page.locator('tr:has(th[title="Раунд:11, по 10 карт"]) .frac').innerText(), '10', 'limited round label');
console.log('ok  limited round label 11/10');
await btn('Следующий раунд').click();
assert.equal(await page.getByText('В игре 0 ставок из 10').count(), 1, 'round 11 has 10 cards');
console.log('ok  round 11 limited to 10 cards');

await page.reload();
assert.equal(await page.getByText('Раунд 11').count(), 1, 'status in list');
assert.equal(await page.getByText(/\d{4}\s?г\./).count(), 1, 'Russian date');
await btn('Продолжить').click();
assert.equal(await page.getByRole('heading', { name: 'Ставки для раунда 11' }).count(), 1, 'continue → bids');
console.log('ok  continue after reload');

assert.deepEqual(errors, [], 'no page errors');
console.log('ALL OK');
await browser.close();
