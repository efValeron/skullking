// Запуск: npm install && npm test   (tsx --test parser.test.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  completeBids,
  mergeResults,
  parseBids,
  parseName,
  parseResults,
  validateResults,
  type Parsed,
  type ResultsDraft,
} from './parser';

interface Expect {
  ok: boolean;
  reason?: string;
  warnings?: number;
  [key: string]: unknown;
}

const cases = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));
const roster: string[] = cases.roster;

function check(r: Parsed<object>, e: Expect): void {
  assert.equal(r.ok, e.ok, JSON.stringify(r));
  if (r.ok) {
    const draft = r.draft as Record<string, unknown>;
    for (const k of ['bids', 'tricks', 'bonus', 'kraken', 'name', 'done']) {
      if (k in e) assert.deepEqual(draft[k], e[k], `${k}: ${JSON.stringify(r)}`);
    }
    if (e.warnings !== undefined) assert.equal(r.warnings.length, e.warnings, JSON.stringify(r));
  } else {
    assert.equal(r.reason, e.reason, JSON.stringify(r));
  }
}

const label = (say: string[]): string => say.map((s) => s || '(пусто)').join(' | ');

for (const c of cases.bids) {
  test(`ставки: ${label(c.say)}`, () => check(parseBids(c.say, roster, { cards: c.cards }), c.expect));
}
for (const c of cases.results) {
  test(`итоги: ${label(c.say)}`, () => check(parseResults(c.say, roster, { cards: c.cards }), c.expect));
}
for (const c of cases.names) {
  test(`имена: ${label(c.say)}`, () => check(parseName(c.say, c.players, c.opts), c.expect));
}
cases.validate.forEach((c: Record<string, unknown>, i: number) => {
  test(`проверка итогов #${i + 1}`, () => {
    const issues = validateResults({
      players: c.players as string[],
      cards: c.cards as number,
      draft: c.draft as ResultsDraft,
      kraken: c.kraken as boolean | undefined,
      bids: c.bids as Record<string, number> | undefined,
    });
    assert.deepEqual(
      issues.map((x) => x.code),
      c.expectIssues,
    );
  });
});

// ---------- сценарии целиком ----------

test('неупомянутые игроки получают 0', () => {
  const r = parseBids(['Аня два'], roster, { cards: 5 });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(completeBids(r.draft, ['Аня', 'Дима']), { Аня: 2, Дима: 0 });
});

test('итоги можно диктовать частями, сумма проверяется по накопленному черновику', () => {
  const players = ['Аня', 'Дима', 'Оля'];
  const a = parseResults(['Аня два Дима один'], players, { cards: 5 });
  const b = parseResults(['Оля два'], players, { cards: 5 });
  assert.ok(a.ok && b.ok);
  if (a.ok && b.ok) {
    const partial = validateResults({ players, cards: 5, draft: a.draft });
    assert.deepEqual(partial.map((x) => x.code), ['sum_mismatch']);
    const merged = mergeResults(a.draft, b.draft);
    assert.deepEqual(validateResults({ players, cards: 5, draft: merged }), []);
  }
});

test('кракен, названный позже, меняет ожидаемую сумму взяток', () => {
  const players = ['Аня', 'Дима', 'Оля'];
  const a = parseResults(['Аня два Дима один Оля один'], players, { cards: 5 });
  const k = parseResults(['кракен'], players, { cards: 5 });
  assert.ok(a.ok && k.ok);
  if (a.ok && k.ok) {
    assert.deepEqual(validateResults({ players, cards: 5, draft: a.draft }).map((x) => x.code), ['sum_mismatch']);
    assert.deepEqual(validateResults({ players, cards: 5, draft: mergeResults(a.draft, k.draft) }), []);
  }
});
