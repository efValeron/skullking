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

/**
 * Web Speech API engine. The browser stops after every pause, so the engine restarts it until stop():
 * one phrase per browser session (continuous mode repeats earlier text on Android Chrome).
 */
export function createWebSpeechEngine(lang = 'ru-RU', Ctor = speechCtor()): SpeechEngine | null {
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = true;
  rec.maxAlternatives = 5; // several hypotheses: the first one that fits the grammar wins
  rec.continuous = false;
  let on = false;
  let started = 0;
  let heard = false;
  let quick = 0; // sessions in a row that ended at once with nothing heard: the browser refuses, give up
  const begin = () => {
    started = Date.now();
    heard = false;
    rec.start();
  };
  const engine: SpeechEngine = {
    start: () => {
      if (on) return;
      on = true;
      quick = 0;
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
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (r.isFinal) engine.onResult?.(Array.from(r, (a) => a.transcript));
      else engine.onInterim?.(r[0]?.transcript ?? '');
    }
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
