// Glue between voice-core drafts and the game. Voice never writes the game directly:
// screens keep a draft, the user accepts it (docs/voice-design.md, «Принципы отсева шума»).
import {
  completeBids,
  parseName,
  validateResults,
  type BidsDraft,
  type Fail,
  type Issue,
  type ResultsDraft,
} from '../../voice-core/parser';
import type { Round } from '../game/model';

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
const ACCEPT = ['принять', 'принимаю'];
const CANCEL = ['отмена', 'отменить'];

/** «принять» / «отмена» said instead of a draft phrase. */
export const voiceCommand = (alts: string[]): 'accept' | 'cancel' | null =>
  alts.some((a) => ACCEPT.includes(word(a))) ? 'accept' : alts.some((a) => CANCEL.includes(word(a))) ? 'cancel' : null;

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
  'no-speech': 'Ничего не расслышал',
  'audio-capture': 'Микрофон не найден',
  network: 'Нет связи с распознаванием речи',
};

/** Names of players still in the round (away players can't be named). */
export const activeNames = (names: string[], r: Round): string[] => names.filter((_, i) => !r.players[i]?.away);

// ---------- bids ----------

/** Accepted bids: named players get their number, the rest 0; away players keep theirs. */
export function bidsFromDraft(names: string[], r: Round, d: BidsDraft): number[] {
  const full = completeBids(d, activeNames(names, r));
  return r.players.map((p, i) => (p.away ? p.bid : (full[names[i]!] ?? 0)));
}

export const bidsChips = (names: string[], r: Round, d: BidsDraft): string[] =>
  activeNames(names, r).map((n) => (d.bids[n] === undefined ? `${n} 0 (по умолчанию)` : `${n} ${d.bids[n]}`));

// ---------- round results ----------

/** Accepted results: tricks for every active player (unnamed = 0), bonus only for named, Kraken if said. */
export const roundFromDraft = (names: string[], r: Round, d: ResultsDraft): Round => ({
  ...r,
  kraken: d.kraken ?? r.kraken,
  players: r.players.map((p, i) => (p.away ? p : { ...p, trick: d.tricks[names[i]!] ?? 0, bonus: d.bonus[names[i]!] ?? p.bonus })),
});

export const resultIssues = (names: string[], r: Round, d: ResultsDraft): Issue[] =>
  validateResults({
    players: activeNames(names, r),
    cards: r.cardsInRound,
    draft: d,
    kraken: r.kraken,
    bids: Object.fromEntries(r.players.map((p, i) => [names[i]!, p.bid])),
  });

export function resultChips(names: string[], r: Round, d: ResultsDraft): string[] {
  const out = activeNames(names, r).map((n) => {
    const tr = d.tricks[n];
    const bonus = d.bonus[n] ? ` +${d.bonus[n]}` : '';
    return tr === undefined ? `${n} 0 (по умолчанию)${bonus}` : `${n} ${tr}${bonus}`;
  });
  if (d.kraken !== undefined) out.push(d.kraken ? 'Кракен' : 'без Кракена');
  return out;
}
