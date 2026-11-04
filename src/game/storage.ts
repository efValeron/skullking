import type { Game } from './model';

const GAMES = 'skk.saved_games';
const NAMES = 'skk.names_history';

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    // Corrupt or blocked storage: start clean rather than crash.
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked (private mode): the game keeps working in memory.
  }
}

/** Oldest first, like the original; the start screen shows them reversed. */
export const loadGames = (): Game[] => read<Game[]>(GAMES, []);
export const saveGames = (games: Game[]): void => write(GAMES, games);
export const loadNames = (): string[] => read<string[]>(NAMES, []);
export const saveNames = (names: string[]): void => write(NAMES, names);
