// Speech engine behind a small interface (docs/voice-design.md «Движок речи»), so Web Speech API can be
// swapped for another engine (e.g. Vosk offline) without touching the voice logic.

export interface SpeechEngine {
  /** Listen until stop() or a fatal error; pauses don't end it. */
  start(): void;
  stop(): void;
  /** Partial text of the phrase being spoken. */
  onInterim?: (text: string) => void;
  /** Phrase ended by a pause: recognition alternatives, best first. */
  onResult?: (alternatives: string[]) => void;
  /** Fatal engine error code, e.g. 'not-allowed', 'audio-capture', 'network'. */
  onError?: (code: string) => void;
  /** Listening stopped (stop(), a fatal error, or the browser keeps refusing to restart). */
  onEnd?: () => void;
}

// Minimal shape of the browser's SpeechRecognition (not in every TS DOM lib).
interface Alt { transcript: string }
interface Res extends ArrayLike<Alt> { isFinal: boolean }
interface Rec {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<Res> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
export type RecCtor = new () => Rec;

export const speechCtor = (): RecCtor | undefined => {
  const w = globalThis as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

/** Errors that end listening; 'no-speech' (silence) and 'aborted' just restart. */
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported']);

const normWords = (s: string): string[] => s.trim().split(/\s+/).map((w) => w.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}-]/gu, ''));

/**
 * Web Speech API engine in continuous mode: short pauses don't stop the browser (on Android every
 * restart beeps). When it stops by itself (long silence), the engine restarts it until stop().
 * Android Chrome may send a phrase twice, or again with the next words appended: an exact repeat
 * of the previous phrase is dropped, a repeated start is cut off.
 */
export function createWebSpeechEngine(lang = 'ru-RU', Ctor = speechCtor()): SpeechEngine | null {
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = true;
  rec.maxAlternatives = 5; // several hypotheses: the first one that fits the grammar wins
  rec.continuous = true;
  let on = false;
  let started = 0;
  let heard = false;
  let quick = 0; // sessions in a row that ended at once with nothing heard: the browser refuses, give up
  let done = new Set<number>(); // final results of this browser session already passed on
  let last: string[] = []; // words of the previous phrase
  const begin = () => {
    started = Date.now();
    heard = false;
    done = new Set();
    rec.start();
  };
  /** The text after a repeat of the previous phrase; '' when it is that phrase again. */
  const cut = (a: string): string => {
    const w = normWords(a);
    const repeats = last.length > 0 && w.length >= last.length && last.every((x, k) => w[k] === x);
    return (repeats ? a.trim().split(/\s+/).slice(last.length).join(' ') : a).trim();
  };
  const engine: SpeechEngine = {
    start: () => {
      if (on) return;
      on = true;
      quick = 0;
      last = [];
      try {
        begin();
      } catch (e) {
        on = false;
        throw e;
      }
    },
    stop: () => {
      on = false;
      rec.stop();
    },
  };
  rec.onresult = (e) => {
    heard = true;
    const interim: string[] = [];
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (!r.isFinal) {
        interim.push(r[0]?.transcript.trim() ?? '');
        continue;
      }
      if (done.has(i)) continue;
      done.add(i);
      const alts = Array.from(r, (a) => a.transcript);
      if (!cut(alts[0] ?? '')) continue; // the previous phrase again
      const rest = alts.map(cut).filter(Boolean);
      last = normWords(alts[0]!);
      engine.onResult?.(rest);
    }
    const text = cut(interim.filter(Boolean).join(' '));
    if (text) engine.onInterim?.(text);
  };
  rec.onerror = (e) => {
    if (!FATAL.has(e.error)) return;
    on = false;
    engine.onError?.(e.error);
  };
  rec.onend = () => {
    if (on) {
      quick = !heard && Date.now() - started < 1000 ? quick + 1 : 0;
      if (quick < 3) {
        try {
          return begin();
        } catch {
          // fall through: stop
        }
      }
      on = false;
    }
    engine.onEnd?.();
  };
  return engine;
}
