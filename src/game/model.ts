// Game model and pure rules. JSON shape matches the original app (docs/original-spec.md §3).

export const DECK_SIZE = 70;

export interface PlayerRound {
  bid: number;
  trick: number;
  bonus: number;
  away: boolean;
}
export interface Round {
  number: number;
  players: PlayerRound[];
  kraken: boolean;
  bidsFixed: boolean;
  finished: boolean;
  cardsInRound: number;
  /** Dealer (player index), stored once players are reordered; otherwise computed by dealerOf. Not in the original. */
  dealer?: number;
}
export interface Game {
  playerNames: string[];
  rounds: Round[];
  totalRounds: number;
  startRound: number;
  maxCards: number | null;
  startDate: string;
  /** Who deals the first round (player index). Not in the original; missing in old saves = 0. */
  firstDealer?: number;
}
export interface Options {
  totalRounds: number;
  startRound: number;
  maxCards: number | null;
}

export const BONUS_PRESETS = [
  { key: 'bonus14', pts: 10 },
  { key: 'bonus14Black', pts: 20 },
  { key: 'pirateMermaid', pts: 20 },
  { key: 'skullKingPirate', pts: 30 },
  { key: 'mermaidSkullKing', pts: 40 },
  { key: 'loot', pts: 20 },
] as const;
export type BonusKey = (typeof BONUS_PRESETS)[number]['key'];

// ---------- rounds ----------

export const cardsFor = (number: number, maxCards: number | null): number =>
  maxCards != null && number > maxCards ? maxCards : number;

export const lastRound = (g: Game): Round => g.rounds[g.rounds.length - 1]!;

/** Next round: number continues from startRound, `away` carries over from the previous round. */
export function makeRound(g: Pick<Game, 'playerNames' | 'startRound' | 'maxCards' | 'rounds'>): Round {
  const number = g.startRound + g.rounds.length;
  const prev = g.rounds[g.rounds.length - 1];
  return {
    number,
    players: g.playerNames.map((_, i) => ({ bid: 0, trick: 0, bonus: 0, away: prev?.players[i]?.away ?? false })),
    kraken: false,
    bidsFixed: false,
    finished: false,
    cardsInRound: cardsFor(number, g.maxCards),
  };
}

/** Local time without zone, like the original: 2026-11-04T23:31:00.658 */
export const localIso = (d: Date): string => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 23);

export function createGame(playerNames: string[], o: Options, now = new Date(), firstDealer = 0): Game {
  const g: Game = { playerNames, rounds: [], ...o, startDate: localIso(now), firstDealer };
  return { ...g, rounds: [makeRound(g)] };
}

/**
 * Dealer of a round (default: the last one). Starts at firstDealer and passes to the next player
 * each round, skipping players who are out in that round.
 */
export function dealerOf(g: Game, roundIndex = g.rounds.length - 1): number {
  const n = g.playerNames.length;
  if (!n) return 0;
  let d = Math.min(Math.max(g.firstDealer ?? 0, 0), n - 1);
  for (let k = 0; k <= roundIndex; k++) {
    const r = g.rounds[k];
    const away = r?.players.map((p) => p.away) ?? [];
    let c = r?.dealer ?? (k === 0 ? d : d + 1); // stored after a reorder, else the next player
    for (let s = 0; s < n && away[c % n]; s++) c++;
    d = c % n;
  }
  return d;
}

/** Dealer choice after removing row `removed` on the players screen: it follows its player, or falls back to the first. */
export const dealerAfterRemove = (dealer: number, removed: number): number =>
  removed < dealer ? dealer - 1 : removed === dealer ? 0 : dealer;

export const updateLast = (g: Game, fn: (r: Round) => Round): Game => ({ ...g, rounds: [...g.rounds.slice(0, -1), fn(lastRound(g))] });

export const nextRound = (g: Game): Game => ({ ...g, rounds: [...g.rounds, makeRound(g)] });

/** «Начать раунд заново»: back to bids with zeros; `away` stays. */
export const resetRound = (g: Game): Game =>
  updateLast(g, (r) => ({
    ...r,
    players: r.players.map((p) => ({ bid: 0, trick: 0, bonus: 0, away: p.away })),
    kraken: false,
    bidsFixed: false,
    finished: false,
  }));

export const setBids = (r: Round, bids: number[]): Round => ({ ...r, players: r.players.map((p, i) => ({ ...p, bid: bids[i] ?? p.bid })) });

export const bidsTotal = (r: Round): number => r.players.reduce((s, p) => s + p.bid, 0);
export const tricksTaken = (r: Round): number => r.players.reduce((s, p) => s + (p.away ? 0 : p.trick), 0);
/** Kraken removes one trick from the round. */
export const expectedTricks = (r: Round): number => r.cardsInRound - (r.kraken ? 1 : 0);
export const canFinish = (r: Round): boolean => tricksTaken(r) === expectedTricks(r);

/** Bonus counts only for an exact bid, so it is cleared in data on finish (as the original does). */
export const normalizeFinished = (r: Round): Round => ({
  ...r,
  finished: true,
  players: r.players.map((p) => (p.away || p.bid !== p.trick ? { ...p, bonus: 0 } : p)),
});

export const isGameFinished = (g: Game): boolean => {
  const r = lastRound(g);
  return r.finished && r.number >= g.totalRounds;
};

export const hasFinishedRound = (g: Game): boolean => g.rounds.some((r) => r.finished);

// ---------- scoring (original-spec §4) ----------

export function playerScore(p: PlayerRound, cards: number): number {
  if (p.away) return 0;
  if (p.bid === p.trick) return (p.bid === 0 ? cards * 10 : p.bid * 20) + p.bonus;
  return p.bid === 0 ? -cards * 10 : -Math.abs(p.bid - p.trick) * 10;
}

/** totals[r][i] — running total of player i after round r; unfinished rounds add nothing. */
export function runningTotals(rounds: Round[], players: number): number[][] {
  const acc: number[] = Array.from({ length: players }, () => 0);
  return rounds.map((r) => acc.map((sum, i) => (acc[i] = sum + (r.finished ? playerScore(r.players[i]!, r.cardsInRound) : 0))));
}

// ---------- options / deck ----------

export const cardsNeeded = (players: number, totalRounds: number): number => players * totalRounds;
export const defaultLimit = (players: number): number => Math.max(1, Math.floor(DECK_SIZE / players));

/**
 * Fix of the original: its suggested limit was shown but stored only after touching the stepper.
 * Here the limit applies as soon as the deck is short; `limit` is the user's choice, if any.
 */
export const effectiveMaxCards = (players: number, totalRounds: number, limit: number | null): number | null =>
  cardsNeeded(players, totalRounds) > DECK_SIZE ? Math.min(limit ?? defaultLimit(players), totalRounds) : null;

export const applyOptions = (g: Game, o: Pick<Options, 'totalRounds' | 'maxCards'>): Game => ({ ...g, ...o });

/** Edit players: rename and set «в игре» on the current (last) round, like the original. */
/**
 * Edit players: rename, reorder (`order[i]` = old index of the player now at i) and set «в игре» on the
 * current round, like the original. Scores move with their players; each round keeps its dealer, so the
 * next round goes to whoever now sits after the current dealer.
 */
export function applyPlayers(g: Game, names: string[], inGame: boolean[], order = names.map((_, i) => i)): Game {
  const at = (old: number) => order.indexOf(old);
  const rounds = g.rounds.map((r, k) => ({ ...r, dealer: at(dealerOf(g, k)), players: order.map((o) => r.players[o]!) }));
  return updateLast({ ...g, playerNames: names, rounds, firstDealer: at(g.firstDealer ?? 0) }, (r) => ({
    ...r,
    players: r.players.map((p, i) => ({ ...p, away: !(inGame[i] ?? true) })),
  }));
}

// ---------- names ----------

export const mergeNames = (history: string[], names: string[]): string[] => {
  const out = [...history];
  for (const n of names.map((s) => s.trim())) if (n && !out.includes(n)) out.push(n);
  return out;
};

export const suggestNames = (history: string[], text: string): string[] => {
  const q = text.trim().toLowerCase();
  return q ? history.filter((n) => n.toLowerCase().includes(q)) : [];
};

export const namesValid = (names: string[]): boolean => names.length > 0 && names.every((n) => n.trim() !== '');
