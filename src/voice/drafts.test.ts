import { describe, expect, it } from 'vitest';
import { parseBids, parseResults, mergeResults, type ResultsDraft } from '../../voice-core/parser';
import { createGame, lastRound, updateLast, type Round } from '../game/model';
import { bidsChips, bidsFromDraft, failText, fillNames, namesFromVoice, resultChips, resultIssues, roundFromDraft, voiceCommand } from './drafts';
import { createWebSpeechEngine } from './engine';

const names = ['Аня', 'Дима', 'Оля'];
const round = (cards: number, patch: (r: Round) => Round = (r) => r): Round => {
  const g = createGame(names, { totalRounds: 10, startRound: cards, maxCards: null });
  return lastRound(updateLast(g, patch));
};
const ok = <T,>(p: { ok: true; draft: T } | { ok: false }): T => {
  if (!p.ok) throw new Error('parse failed');
  return p.draft;
};

describe('voice commands', () => {
  it('accept / cancel / other', () => {
    expect(voiceCommand(['Принять!'])).toBe('accept');
    expect(voiceCommand(['что-то', 'отмена'])).toBe('cancel');
    expect(voiceCommand(['Аня два'])).toBe(null);
  });
});

describe('names: several in one phrase', () => {
  const names = (alts: string[], existing: string[] = []) => {
    const r = namesFromVoice(alts, existing);
    return r.ok ? [r.names, r.done] : r.reason;
  };
  it('splits by spaces, commas and «и»', () => expect(names(['Аня, Дима и Оля Иван'])).toEqual([['Аня', 'Дима', 'Оля', 'Иван'], false]));
  it('one name still works; hyphenated name is one', () => expect(names(['анна-мария'])).toEqual([['Анна-Мария'], false]));
  it('trailing «готово» ends input', () => expect(names(['Аня Дима готово'])).toEqual([['Аня', 'Дима'], true]));
  it('noise rejects the whole phrase', () => {
    expect(names(['Аня два'])).toBe('bad_name');
    expect(names(['ну давай уже'])).toBe('bad_name');
    expect(names(['Аня, ходи уже'])).toBe('bad_name');
    expect(names(['Иван твой ход'])).toBe('bad_name');
    expect(names(['подожди, Оля'])).toBe('bad_name');
  });
  it('duplicates: inside the phrase and against filled fields', () => {
    expect(names(['Аня Аня'])).toBe('duplicate');
    expect(names(['Дима Аня'], ['Аня'])).toBe('duplicate');
  });
  it('first alternative that passes wins', () => expect(names(['Аня 2 Дима', 'Аня Дима'])).toEqual([['Аня', 'Дима'], false]));
  it('fills empty fields, then appends rows', () => {
    expect(fillNames(['', 'Дима', ''], ['Аня', 'Оля', 'Иван'])).toEqual(['Аня', 'Дима', 'Оля', 'Иван']);
    expect(fillNames([], ['Аня'])).toEqual(['Аня']);
  });
});

describe('bids draft', () => {
  const r = round(3);
  const d = ok(parseBids(['Аня два, Дима один'], names, { cards: 3 }));
  it('unnamed players get 0', () => expect(bidsFromDraft(names, r, d)).toEqual([2, 1, 0]));
  it('chips mark defaults', () => expect(bidsChips(names, r, d)).toEqual(['Аня 2', 'Дима 1', 'Оля 0 (по умолчанию)']));
  it('away players are skipped and keep their bid', () => {
    const away = round(3, (x) => ({ ...x, players: x.players.map((p, i) => (i === 2 ? { ...p, away: true, bid: 0 } : p)) }));
    expect(bidsChips(names, away, d)).toEqual(['Аня 2', 'Дима 1']);
    expect(bidsFromDraft(names, away, d)).toEqual([2, 1, 0]);
  });
  it('noise is rejected with a readable reason', () => {
    const f = parseBids(['Дима, у тебя два туза'], names, { cards: 3 });
    expect(f.ok).toBe(false);
    if (!f.ok) expect(failText(f)).toMatch(/^Не понял: «Дима, у тебя два туза» — /);
  });
});

describe('results draft', () => {
  const r = round(2, (x) => ({ ...x, bidsFixed: true, players: x.players.map((p, i) => ({ ...p, bid: [1, 1, 0][i]!, bonus: i === 2 ? 10 : 0 })) }));
  it('applies tricks to all, bonus only to named, kraken if said', () => {
    const d = ok(parseResults(['кракен, Аня один, Дима бонус двадцать'], names, { cards: 2 }));
    const next = roundFromDraft(names, r, d);
    expect(next.kraken).toBe(true);
    expect(next.players.map((p) => [p.trick, p.bonus])).toEqual([[1, 0], [0, 20], [0, 10]]);
  });
  it('sum mismatch blocks, Kraken removes one trick', () => {
    const d = ok(parseResults(['Аня один'], names, { cards: 2 }));
    expect(resultIssues(names, r, d).map((i) => i.code)).toEqual(['sum_mismatch']);
    const k: ResultsDraft = mergeResults(d, ok(parseResults(['кракен'], names, { cards: 2 })));
    expect(resultIssues(names, r, k)).toEqual([]);
  });
  it('warns when a bonus will not count', () => {
    const d = ok(parseResults(['Аня два Дима бонус двадцать'], names, { cards: 2 }));
    expect(resultIssues(names, r, d).map((i) => i.code)).toEqual(['bonus_ignored']);
  });
  it('chips', () => {
    const d = ok(parseResults(['без кракена Аня два бонус сорок'], names, { cards: 2 }));
    expect(resultChips(names, r, d)).toEqual(['Аня 2 +40', 'Дима 0 (по умолчанию)', 'Оля 0 (по умолчанию)', 'без Кракена']);
  });
});

describe('web speech engine adapter', () => {
  it('passes final alternatives and interim text through', () => {
    const got: string[][] = [];
    const interim: string[] = [];
    let ended = false;
    class FakeRec {
      lang = '';
      interimResults = false;
      maxAlternatives = 1;
      continuous = true;
      onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        const partial = Object.assign([{ transcript: 'Аня' }], { isFinal: false });
        const final = Object.assign([{ transcript: 'Аня два' }, { transcript: 'Ане два' }], { isFinal: true });
        this.onresult?.({ resultIndex: 0, results: [partial] });
        this.onresult?.({ resultIndex: 0, results: [final] });
        this.onend?.();
      }
      stop() {}
    }
    const e = createWebSpeechEngine('ru-RU', FakeRec)!;
    e.onResult = (a) => got.push(a);
    e.onInterim = (s) => interim.push(s);
    e.onEnd = () => (ended = true);
    e.start();
    expect(interim).toEqual(['Аня']);
    expect(got).toEqual([['Аня два', 'Ане два']]);
    expect(ended).toBe(true);
  });
  it('no engine without browser support', () => expect(createWebSpeechEngine('ru-RU', undefined)).toBe(null));
});
