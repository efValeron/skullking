// Speech engine behind a small interface (docs/voice-design.md «Движок речи»), so Web Speech API can be
// swapped for another engine (e.g. Vosk offline) without touching the voice logic.

export interface SpeechEngine {
  start(): void;
  stop(): void;
  /** Partial text while the user speaks. */
  onInterim?: (text: string) => void;
  /** Final phrase: recognition alternatives, best first. */
  onResult?: (alternatives: string[]) => void;
  /** Engine error code, e.g. 'not-allowed', 'no-speech', 'network'. */
  onError?: (code: string) => void;
  /** Listening stopped (after a pause, stop() or an error). */
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

/** Web Speech API engine: one phrase per start(), the browser stops by itself after a pause. */
export function createWebSpeechEngine(lang = 'ru-RU', Ctor = speechCtor()): SpeechEngine | null {
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = true;
  rec.maxAlternatives = 5; // several hypotheses: the first one that fits the grammar wins
  rec.continuous = false;
  const engine: SpeechEngine = { start: () => rec.start(), stop: () => rec.stop() };
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (r.isFinal) engine.onResult?.(Array.from(r, (a) => a.transcript));
      else engine.onInterim?.(r[0]?.transcript ?? '');
    }
  };
  rec.onerror = (e) => engine.onError?.(e.error);
  rec.onend = () => engine.onEnd?.();
  return engine;
}
