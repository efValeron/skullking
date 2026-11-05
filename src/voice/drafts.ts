// Glue between voice-core and the screens. Voice fills the open screen's fields (highlighted, undoable);
// the game takes them only through the screen's own buttons (docs/voice-design.md, «Принципы отсева шума»).
import { parseBids, parseName, parseResults, validateResults, type Fail, type Issue, type ResultsDraft } from '../../voice-core/parser';
import type { Round } from '../game/model';

/** A phrase applied to a screen's form: the new form, the fields it set (highlighted), notes. */
export interface Applied<S> {
  ok: true;
  state: S;
  marks: string[];
  warnings: string[];
  heard: string;
}
export type ApplyPhrase<S> = (alternatives: string[], base: S) => Applied<S> | Fail;

// ---------- names: several in one phrase ----------

const NAME_SEP = /[\s,.;:!?]+/;
const DONE = ['готово', 'хватит', 'достаточно', 'конец']; // same as voice-core's NAME_DONE
// Table talk that is never a name; with several names per phrase it would otherwise fill rows («Аня, ходи уже»).
const NOT_NAMES = new Set(
  'я ты вы мы он она они мой моя твой твоя тебя меня тебе мне его ее их кто что где как там тут здесь сейчас уже еще тоже только все ход ходи ходить ходишь играем играть играю давайте слушай смотри погоди подожди стоп блин окей ок хорошо будет есть был была'.split(' '),
);

/**
 * «Аня, Дима и Оля»: every word goes through voice-core's parseName, so the noise rules stay
 * (a number, a filler word or a duplicate rejects the whole phrase). A final «готово» ends input.
 * One word per name; a hyphenated name («Анна-Мария») is one word.
 */
export function namesFromVoice(
  alts: string[],
  existing: string[],
): { ok: true; names: string[]; done: boolean; warnings: string[]; heard: string } | Fail {
  let first: Fail | null = null;
  for (const heard of alts.filter((a) => a && a.trim())) {
    const words = heard.trim().split(NAME_SEP).filter((w) => w && w.toLowerCase() !== 'и');
    const done = words.length > 0 && DONE.includes(words[words.length - 1]!.toLowerCase());
    if (done) words.pop();
    const names: string[] = [];
    const warnings: string[] = [];
    let fail: Fail | null = null;
    for (const w of words) {
      if (NOT_NAMES.has(w.toLowerCase().replace(/ё/g, 'е'))) {
        fail = { ok: false, reason: 'bad_name', detail: w, heard };
        break;
      }
      const r = parseName([w], [...existing, ...names]);
      if (!r.ok) {
        fail = { ...r, heard };
        break;
      }
      if (r.draft.name) names.push(r.draft.name);
      warnings.push(...r.warnings);
    }
    if (!fail && (names.length || done)) return { ok: true, names, done, warnings, heard };
    first ??= fail ?? { ok: false, reason: 'empty', heard };
  }
  return first ?? { ok: false, reason: 'empty', heard: '' };
}

/** New names go into the empty fields in order; the rest become new rows. */
export function fillNames(fields: string[], names: string[]): string[] {
  const out = [...fields];
  const queue = [...names];
  for (let i = 0; i < out.length && queue.length; i++) if (!out[i]!.trim()) out[i] = queue.shift()!;
  return [...out, ...queue];
}

const word = (s: string) => s.toLowerCase().replace(/[^a-zа-яё]/g, '');
const CANCEL = ['отмена', 'отменить', 'отмени'];
/** Said at the end of a phrase: stop listening. */
const STOP = ['стоп', 'готово', 'всё', 'все', 'хватит'];
const lastWord = (s: string) => s.trim().split(/\s+/).pop() ?? '';

/**
 * «отмена» alone undoes the last phrase; a stop word at the end («…Миша ноль, всё») stops listening,
 * the rest of the phrase still counts.
 */
export function voiceCommand(alts: string[]): { cancel: boolean; stop: boolean; rest: string[] } {
  if (alts.some((a) => CANCEL.includes(word(a)))) return { cancel: true, stop: false, rest: [] };
  const stop = STOP.includes(word(lastWord(alts[0] ?? '')));
  if (!stop) return { cancel: false, stop, rest: alts };
  const rest = alts.map((a) => (STOP.includes(word(lastWord(a))) ? a.trim().replace(/\S+$/, '') : a).trim()).filter(Boolean);
  return { cancel: false, stop, rest };
}

// Voice works for Russian only (voice-core grammar), so these texts are Russian.
const REASON: Record<Fail['reason'], string> = {
  empty: 'ничего не расслышал',
  unknown_word: 'не разобрал',
  no_pairs: 'нет имени с числом',
  out_of_range: 'число больше, чем карт',
  conflict: 'два разных числа для одного игрока',
  ambiguous_name: 'непонятно, кто',
  duplicate: 'такое имя уже есть',
  bad_name: 'не похоже на имя',
};
export const failText = (f: Fail): string =>
  `Не понял${f.heard ? `: «${f.heard}»` : ''} — ${REASON[f.reason]}${f.detail ? ` (${f.detail})` : ''}`;

export const ENGINE_ERROR: Record<string, string> = {
  'not-allowed': 'Нет доступа к микрофону',
  'service-not-allowed': 'Нет доступа к микрофону',
  'audio-capture': 'Микрофон не найден',
  network: 'Нет связи с распознаванием речи',
};

/** Names of players still in the round (away players can't be named). */
export const activeNames = (names: string[], r: Round): string[] => names.filter((_, i) => !r.players[i]?.away);

/** Names: they fill the empty fields of `base` in order (fillNames). */
export const applyNames: ApplyPhrase<string[]> = (alts, base) => {
  const res = namesFromVoice(alts, base.filter((n) => n.trim()));
  if (!res.ok) return res;
  if (!res.names.length) return { ok: false, reason: 'empty', heard: res.heard };
  const state = fillNames(base, res.names);
  const marks = state.flatMap((n, i) => (n !== base[i] ? [`name:${i}`] : []));
  return { ok: true, state, marks, warnings: res.warnings, heard: res.heard };
};

// ---------- bids ----------

/** Bids: named players get their number, the rest keep theirs (away players aren't in the grammar). */
export const applyBids =
  (names: string[], r: Round): ApplyPhrase<number[]> =>
  (alts, base) => {
    const res = parseBids(alts, activeNames(names, r), { cards: r.cardsInRound });
    if (!res.ok) return res;
    const { bids } = res.draft;
    return {
      ok: true,
      state: base.map((b, i) => bids[names[i]!] ?? b),
      marks: Object.keys(bids).map((n) => `bid:${names.indexOf(n)}`),
      warnings: res.warnings,
      heard: res.heard,
    };
  };

// ---------- round results ----------

/** Results over the round: tricks and bonus only for named players, Kraken if said. */
export const roundFromDraft = (names: string[], r: Round, d: ResultsDraft): Round => ({
  ...r,
  kraken: d.kraken ?? r.kraken,
  players: r.players.map((p, i) => (p.away ? p : { ...p, trick: d.tricks[names[i]!] ?? p.trick, bonus: d.bonus[names[i]!] ?? p.bonus })),
});

export const applyResults =
  (names: string[]): ApplyPhrase<Round> =>
  (alts, base) => {
    const res = parseResults(alts, activeNames(names, base), { cards: base.cardsInRound });
    if (!res.ok) return res;
    const d = res.draft;
    const at = (key: string) => (n: string) => `${key}:${names.indexOf(n)}`;
    const marks = [...Object.keys(d.tricks).map(at('trick')), ...Object.keys(d.bonus).map(at('bonus')), ...(d.kraken === undefined ? [] : ['kraken'])];
    return { ok: true, state: roundFromDraft(names, base, d), marks, warnings: res.warnings, heard: res.heard };
  };

/** Checks of the round as it stands (sum of tricks, bonus that won't count): shown while dictating. */
export function roundIssues(names: string[], r: Round): Issue[] {
  const act = r.players.flatMap((p, i) => (p.away ? [] : [{ p, n: names[i]! }]));
  return validateResults({
    players: act.map((a) => a.n),
    cards: r.cardsInRound,
    draft: { tricks: Object.fromEntries(act.map((a) => [a.n, a.p.trick])), bonus: Object.fromEntries(act.map((a) => [a.n, a.p.bonus])) },
    kraken: r.kraken,
    bids: Object.fromEntries(act.map((a) => [a.n, a.p.bid])),
  });
}
