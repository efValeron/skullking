// Glue between voice-core drafts and the game. Voice never writes the game directly:
// screens keep a draft, the user accepts it (docs/voice-design.md, «Принципы отсева шума»).
import {
  completeBids,
  validateResults,
  type BidsDraft,
  type Fail,
  type Issue,
  type ResultsDraft,
} from '../../voice-core/parser';
import type { Round } from '../game/model';

const word = (s: string) => s.toLowerCase().replace(/[^a-zа-яё]/g, '');
const ACCEPT = ['принять', 'принимаю'];
const CANCEL = ['отмена', 'отменить'];

/** «принять» / «отмена» said instead of a draft phrase. */
export const voiceCommand = (alts: string[]): 'accept' | 'cancel' | null =>
  alts.some((a) => ACCEPT.includes(word(a))) ? 'accept' : alts.some((a) => CANCEL.includes(word(a))) ? 'cancel' : null;

// Voice works for Russian only (voice-core grammar), so these texts are Russian.
const REASON: Record<Fail['reason'], string> = {
  empty: 'ничего не расслышал',
  unknown_word: 'лишнее слово',
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
