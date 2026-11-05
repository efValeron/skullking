import { describe, expect, it } from 'vitest';
import { parseBids, parseResults } from '../../voice-core/parser';
import { createGame, lastRound, updateLast, type Round } from '../game/model';
import { applyBids, applyNames, applyResults, failText, fillNames, namesFromVoice, roundFromDraft, roundIssues, voiceCommand } from './drafts';
import { createWebSpeechEngine, type RecCtor } from './engine';

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
  it('«отмена» alone undoes', () => {
    expect(voiceCommand(['что-то', 'отмена'])).toEqual({ cancel: true, stop: false, rest: [] });
    expect(voiceCommand(['Аня два'])).toEqual({ cancel: false, stop: false, rest: ['Аня два'] });
  });
  it('a stop word at the end stops, the rest still counts', () => {
    expect(voiceCommand(['Миша ноль всё', 'Миша ноль все'])).toEqual({ cancel: false, stop: true, rest: ['Миша ноль', 'Миша ноль'] });
    expect(voiceCommand(['Стоп.'])).toEqual({ cancel: false, stop: true, rest: [] });
    expect(voiceCommand(['готово']).stop).toBe(true);
    expect(voiceCommand(['всё, Валера два']).stop).toBe(false);
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
  it('applied to the form: filled fields are marked', () => {
    const a = applyNames(['Аня Оля'], ['', 'Дима', '']);
    expect(a.ok && [a.state, a.marks]).toEqual([['Аня', 'Дима', 'Оля'], ['name:0', 'name:2']]);
  });
});

describe('bids by voice', () => {
  const r = round(3);
  it('named players get their number, the rest keep theirs', () => {
    const a = applyBids(names, r)(['Аня два, Дима один'], [0, 0, 3]);
    expect(a.ok && [a.state, a.marks]).toEqual([[2, 1, 3], ['bid:0', 'bid:1']]);
  });
  it('similar names are separate players; one name for two players is not guessed', () => {
    const g = createGame(['Валера', 'Валерон', 'Женя', 'Жека', 'Женя'], { totalRounds: 10, startRound: 3, maxCards: null });
    const apply = applyBids(g.playerNames, lastRound(g));
    const a = apply(['Валерону два Валера один Жека три'], [0, 0, 0, 0, 0]);
    expect(a.ok && a.state).toEqual([1, 2, 0, 3, 0]);
    expect(apply(['Валерн два'], [0, 0, 0, 0, 0]).ok).toBe(false); // no guessing a near name
    const f = apply(['Женя два'], [0, 0, 0, 0, 0]);
    expect(!f.ok && failText(f)).toBe('Не понял: «Женя два» — «женя» зовут двоих, дай им разные имена');
  });
  it('away players are not in the grammar', () => {
    const away = round(3, (x) => ({ ...x, players: x.players.map((p, i) => (i === 2 ? { ...p, away: true } : p)) }));
    expect(applyBids(names, away)(['Оля два'], [0, 0, 0]).ok).toBe(false);
  });
  it('noise is rejected with a readable reason', () => {
    const f = parseBids(['Дима, у тебя два туза'], names, { cards: 3 });
    expect(f.ok).toBe(false);
    if (!f.ok) expect(failText(f)).toMatch(/^Не понял: «Дима, у тебя два туза» — /);
  });
});

describe('results by voice', () => {
  const r = round(2, (x) => ({ ...x, bidsFixed: true, players: x.players.map((p, i) => ({ ...p, bid: [1, 1, 0][i]!, bonus: i === 2 ? 10 : 0 })) }));
  it('tricks and bonus only for named players, Kraken if said', () => {
    const d = ok(parseResults(['кракен, Аня один, Дима бонус двадцать'], names, { cards: 2 }));
    const next = roundFromDraft(names, r, d);
    expect(next.kraken).toBe(true);
    expect(next.players.map((p) => [p.trick, p.bonus])).toEqual([[1, 0], [0, 20], [0, 10]]);
  });
  it('marks what the phrase set', () => {
    const a = applyResults(names)(['кракен Дима один бонус двадцать'], r);
    expect(a.ok && a.marks).toEqual(['trick:1', 'bonus:1', 'kraken']);
  });
  it('round checks: sum of tricks, Kraken removes one', () => {
    expect(roundIssues(names, r).map((i) => i.code)).toEqual(['sum_mismatch']);
    const one = { ...r, kraken: true, players: r.players.map((p, i) => (i === 0 ? { ...p, trick: 1 } : p)) };
    expect(roundIssues(names, one)).toEqual([]);
  });
  it('warns when a bonus will not count', () => {
    const next = roundFromDraft(names, r, ok(parseResults(['Аня один Дима бонус двадцать'], names, { cards: 2 })));
    expect(roundIssues(names, next).filter((i) => i.level === 'warn').map((i) => i.msg)).toEqual(['Дима: ставка не сошлась, бонус 20 не засчитается']);
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
      started = false;
      start() {
        if (this.started) return; // the restart after the pause just waits
        this.started = true;
        const partial = Object.assign([{ transcript: 'Аня' }], { isFinal: false });
        const final = Object.assign([{ transcript: 'Аня два' }, { transcript: 'Ане два' }], { isFinal: true });
        this.onresult?.({ resultIndex: 0, results: [partial] });
        this.onresult?.({ resultIndex: 0, results: [final] });
        this.onend?.();
      }
      stop() {
        this.onend?.();
      }
    }
    const e = createWebSpeechEngine('ru-RU', FakeRec)!;
    e.onResult = (a) => got.push(a);
    e.onInterim = (s) => interim.push(s);
    e.onEnd = () => (ended = true);
    e.start();
    expect(interim).toEqual(['Аня']);
    expect(got).toEqual([['Аня два', 'Ане два']]);
    expect(ended).toBe(false);
    e.stop();
    expect(ended).toBe(true);
  });
  it('restarts after a pause until stop(); fatal errors and refusals end it', () => {
    let starts = 0;
    let last: Rec2 | null = null;
    class Rec2 {
      lang = '';
      interimResults = false;
      maxAlternatives = 1;
      continuous = true;
      onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        starts++;
        last = this;
      }
      stop() {
        this.onend?.();
      }
    }
    const e = createWebSpeechEngine('ru-RU', Rec2 as unknown as RecCtor)!;
    let ended = 0;
    e.onEnd = () => ended++;
    e.start();
    const say = (text: string) => last!.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
    say('Аня два');
    last!.onend?.(); // the browser stops after the pause
    expect([starts, ended]).toEqual([2, 0]);
    last!.onerror?.({ error: 'no-speech' });
    say('Дима один');
    last!.onend?.();
    expect([starts, ended]).toEqual([3, 0]);
    e.stop();
    expect([starts, ended]).toEqual([3, 1]);
    // the browser keeps ending at once with nothing heard: give up after a few tries
    e.start();
    for (let i = 0; i < 3; i++) last!.onend?.();
    expect(ended).toBe(2);
    // a fatal error ends listening
    e.start();
    last!.onerror?.({ error: 'not-allowed' });
    last!.onend?.();
    expect(ended).toBe(3);
  });
  it('continuous: each final result once; Android repeats dropped or cut', () => {
    let rec: { onresult: ((e: unknown) => void) | null } = { onresult: null };
    class Rec3 {
      lang = '';
      interimResults = false;
      maxAlternatives = 1;
      continuous = false;
      onresult: ((e: unknown) => void) | null = null;
      onerror = null;
      onend = null;
      start() {
        rec = this;
      }
      stop() {}
    }
    const e = createWebSpeechEngine('ru-RU', Rec3 as unknown as RecCtor)!;
    const got: string[][] = [];
    const interim: string[] = [];
    e.onResult = (a) => got.push(a);
    e.onInterim = (s) => interim.push(s);
    e.start();
    const res = (text: string, isFinal: boolean) => Object.assign([{ transcript: text }], { isFinal });
    const send = (resultIndex: number, ...results: ReturnType<typeof res>[]) => rec.onresult?.({ resultIndex, results });
    const a = res('Аня два', true);
    send(0, a);
    send(0, a); // the same result again
    send(1, a, res('Аня два', true)); // Android: the phrase once more
    send(2, a, a, res('Аня два Дима', false)); // Android: interim with the old phrase in front
    send(2, a, a, res('Аня два Дима один', true)); // and the final, too
    expect(got).toEqual([['Аня два'], ['Дима один']]);
    expect(interim).toEqual(['Дима']);
    expect((rec as unknown as Rec3).continuous).toBe(true);
  });
  it('no engine without browser support', () => expect(createWebSpeechEngine('ru-RU', undefined)).toBe(null));
});
