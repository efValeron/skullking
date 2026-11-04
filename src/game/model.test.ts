import { describe, expect, it } from 'vitest';
import {
  applyPlayers,
  canFinish,
  cardsFor,
  createGame,
  defaultLimit,
  effectiveMaxCards,
  isGameFinished,
  lastRound,
  mergeNames,
  namesValid,
  nextRound,
  normalizeFinished,
  playerScore,
  resetRound,
  runningTotals,
  setBids,
  suggestNames,
  updateLast,
  type Game,
  type PlayerRound,
} from './model';

const p = (bid: number, trick: number, bonus = 0, away = false): PlayerRound => ({ bid, trick, bonus, away });

/** Plays the last round: bids/tricks/bonus per player, then finishes it. */
function play(g: Game, rows: [number, number, number?, boolean?][], kraken = false): Game {
  return updateLast(g, (r) =>
    normalizeFinished({ ...r, kraken, bidsFixed: true, players: rows.map(([b, t, bo = 0, a = false]) => p(b, t, bo, a)) }),
  );
}

describe('playerScore (original-spec §4)', () => {
  it('exact bid', () => {
    expect(playerScore(p(1, 1, 20), 1)).toBe(40);
    expect(playerScore(p(2, 2, 40), 4)).toBe(80);
  });
  it('zero bid made: cards × 10 + bonus', () => {
    expect(playerScore(p(0, 0, 10), 1)).toBe(20);
    expect(playerScore(p(0, 0, 30), 2)).toBe(50);
    expect(playerScore(p(0, 0), 9)).toBe(90);
  });
  it('missed bid: −10 per trick off, bonus ignored', () => {
    expect(playerScore(p(2, 1, 20), 2)).toBe(-10);
    expect(playerScore(p(2, 0), 3)).toBe(-20);
  });
  it('zero bid missed: −cards × 10', () => {
    expect(playerScore(p(0, 1), 3)).toBe(-30);
    expect(playerScore(p(0, 9), 9)).toBe(-90);
  });
  it('away player scores 0', () => expect(playerScore(p(2, 2, 40, true), 4)).toBe(0));
});

describe('game played in the original on 2026-11-04 (docs/original-ux.md §4)', () => {
  let g = createGame(['Аня', 'Дима', 'Оля'], { totalRounds: 4, startRound: 1, maxCards: null });
  g = play(g, [[1, 1, 20], [0, 0, 10], [0, 0]]);
  g = play(nextRound(g), [[2, 1, 20], [1, 1], [0, 0, 30]]);
  g = play(nextRound(g), [[0, 1], [2, 1], [2, 0]], true);
  g = play(nextRound(g), [[2, 2, 40], [2, 2], [0, 0, 0, true]]);

  it('running totals match the original table', () => {
    expect(runningTotals(g.rounds, 3)).toEqual([
      [40, 20, 10],
      [30, 40, 60],
      [0, 30, 40],
      [80, 70, 40], // original shows «-» for the away player; the clone shows the total (deviations.md B)
    ]);
  });
  it('missed bonus is cleared in data on finish', () => expect(g.rounds[1]!.players[0]!.bonus).toBe(0));
  it('game finishes after the last round', () => expect(isGameFinished(g)).toBe(true));
  it('round numbers and cards', () => expect(g.rounds.map((r) => [r.number, r.cardsInRound])).toEqual([[1, 1], [2, 2], [3, 3], [4, 4]]));
});

describe('finish rule', () => {
  const r = lastRound(createGame(['a', 'b', 'c'], { totalRounds: 10, startRound: 3, maxCards: null }));
  const withTricks = (t: number[], kraken = false) => ({ ...r, kraken, players: t.map((x) => p(0, x)) });
  it('sum must equal cards', () => {
    expect(canFinish(withTricks([1, 1, 1]))).toBe(true);
    expect(canFinish(withTricks([1, 1, 0]))).toBe(false);
  });
  it('with Kraken exactly cards − 1', () => {
    expect(canFinish(withTricks([1, 1, 0], true))).toBe(true);
    expect(canFinish(withTricks([1, 1, 1], true))).toBe(false);
  });
});

describe('rounds and options', () => {
  it('limited rounds use maxCards', () => {
    expect(cardsFor(11, 10)).toBe(10);
    expect(cardsFor(9, 10)).toBe(9);
    expect(cardsFor(11, null)).toBe(11);
  });
  it('start from round 9, limit 10', () => {
    let g = createGame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], { totalRounds: 11, startRound: 9, maxCards: 10 });
    g = nextRound(nextRound(g));
    expect(g.rounds.map((r) => [r.number, r.cardsInRound])).toEqual([[9, 9], [10, 10], [11, 10]]);
  });
  it('deck limit applies immediately (fix of original bug)', () => {
    expect(effectiveMaxCards(7, 10, null)).toBe(null); // 70 cards fit
    expect(effectiveMaxCards(7, 11, null)).toBe(10); // 77 > 70 → floor(70/7)
    expect(effectiveMaxCards(3, 24, null)).toBe(23);
    expect(effectiveMaxCards(3, 26, 1)).toBe(1);
    expect(defaultLimit(3)).toBe(23);
  });
  it('away carries over to next round; reset keeps it', () => {
    let g = createGame(['a', 'b'], { totalRounds: 5, startRound: 1, maxCards: null });
    g = applyPlayers(g, ['a', 'B'], [true, false]);
    expect(g.playerNames).toEqual(['a', 'B']);
    g = updateLast(g, (r) => setBids(r, [1, 0]));
    g = resetRound(g);
    expect(lastRound(g).players).toEqual([p(0, 0), p(0, 0, 0, true)]);
    g = nextRound(updateLast(g, (r) => ({ ...r, finished: true })));
    expect(lastRound(g).players[1]!.away).toBe(true);
  });
});

describe('names', () => {
  it('history keeps first-seen order, no duplicates or blanks', () => expect(mergeNames(['Аня'], ['Дима', ' Аня ', ''])).toEqual(['Аня', 'Дима']));
  it('suggestions: case-insensitive substring', () => expect(suggestNames(['Аня', 'Дима', 'Оля'], 'Я')).toEqual(['Аня', 'Оля']));
  it('valid: at least one, no empty names; duplicates allowed', () => {
    expect(namesValid([])).toBe(false);
    expect(namesValid(['a', ' '])).toBe(false);
    expect(namesValid(['a', 'a'])).toBe(true);
  });
});
