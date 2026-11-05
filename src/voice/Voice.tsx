// Voice input shared by the three voice windows (names, bids, round results): mic and undo in the app bar,
// what the mic hears in place of the title, phrases written straight into the screen's fields.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Fail } from '../../voice-core/parser';
import { t } from '../i18n';
import { Icon } from '../ui';
import { createWebSpeechEngine, speechCtor, type SpeechEngine } from './engine';
import { ENGINE_ERROR, failText, voiceCommand, type ApplyPhrase } from './drafts';
import './voice.css';

export interface Voice {
  supported: boolean;
  listening: boolean;
  /** What the mic hears now, or the last phrase. */
  line: string;
  /** Rejected phrase or engine error (error), or a parser note. */
  note: { text: string; error: boolean } | null;
  /** Fields set by voice since the last manual edit (`bid:0`, `trick:1`, `kraken`…). */
  marks: Set<string>;
  canUndo: boolean;
  toggle: () => void;
  undo: () => void;
}

/** Failures that may be a phrase cut by a pause («Валера…» — «…один»): kept as context for the next one. */
const SOFT = new Set<Fail['reason']>(['empty', 'no_pairs', 'unknown_word']);
const NO_MARKS = new Set<string>();

/**
 * Everything said since the last manual edit is one text, parsed again over the form as it was (`base`):
 * a pause keeps the context, a later mention wins, a rejected phrase is dropped, undo drops the last one.
 */
interface Session<S> {
  base: S;
  steps: { text: string; soft: boolean }[];
  /** JSON of the form as the voice last wrote it: anything else means a manual edit. */
  written: string;
}

/** Mic stays on (pauses included) until a stop word, a second tap or leaving the screen. */
export function useVoice<S>(state: S, setState: (s: S) => void, apply: ApplyPhrase<S>): Voice {
  const [listening, setListening] = useState(false);
  const [line, setLine] = useState('');
  const [note, setNote] = useState<Voice['note']>(null);
  const [marks, setMarks] = useState<Set<string>>(() => new Set());
  const [canUndo, setCanUndo] = useState(false);
  const engine = useRef<SpeechEngine | null>(null);
  const session = useRef<Session<S> | null>(null);
  const latest = useRef({ state, setState, apply });
  latest.current = { state, setState, apply };

  const json = JSON.stringify(state);
  useEffect(() => {
    if (session.current && session.current.written !== json) {
      session.current = null; // manual edit: the next phrase starts from the edited form
      setMarks(new Set());
      setCanUndo(false);
    }
  }, [json]);
  useEffect(() => () => engine.current?.stop(), []);

  const open = (): Session<S> => (session.current ??= { base: latest.current.state, steps: [], written: JSON.stringify(latest.current.state) });
  const said = (s: Session<S>) => s.steps.at(-1)?.text ?? '';
  const write = (s: Session<S>, next: S, m: string[]) => {
    s.written = JSON.stringify(next);
    latest.current.setState(next);
    setMarks(new Set(m));
  };
  /** Form = base + everything kept so far. */
  const replay = (s: Session<S>) => {
    const r = said(s) ? latest.current.apply([said(s)], s.base) : null;
    if (r?.ok) write(s, r.state, r.marks);
    else write(s, s.base, []);
    setCanUndo(s.steps.some((x) => !x.soft));
  };

  /** Interim text fills the form provisionally; a final phrase is kept unless rejected. */
  const hear = (alts: string[], final: boolean) => {
    const s = open();
    const prefix = said(s);
    const full = alts.map((a) => (prefix ? `${prefix} ${a}` : a));
    const r = latest.current.apply(full, s.base);
    if (r.ok) {
      write(s, r.state, r.marks);
      if (final) {
        s.steps.push({ text: r.heard, soft: false });
        setCanUndo(true);
      }
      setNote(r.warnings.length ? { text: r.warnings.at(-1)!, error: false } : null);
      return;
    }
    if (!final) return; // still speaking: keep the last provisional fill
    if (SOFT.has(r.reason)) s.steps.push({ text: full[0]!, soft: true });
    else setNote({ text: failText({ ...r, heard: alts[0] ?? '' }), error: true });
    replay(s);
  };

  const undo = () => {
    const s = session.current;
    if (!s) return;
    while (s.steps.pop()?.soft); // trailing context, then one phrase
    setNote(null);
    replay(s);
  };

  const stop = () => {
    engine.current?.stop();
    setListening(false);
    setLine('');
  };

  const handlers = useRef({ hear, undo, stop });
  handlers.current = { hear, undo, stop };

  const toggle = () => {
    if (listening) return stop();
    if (!engine.current) {
      const e = createWebSpeechEngine('ru-RU');
      if (!e) return;
      e.onInterim = (text) => {
        setLine(text);
        if (text.trim()) handlers.current.hear([text], false);
      };
      e.onResult = (alts) => {
        setLine(alts[0] ?? '');
        const cmd = voiceCommand(alts);
        if (cmd.cancel) handlers.current.undo();
        else if (cmd.rest.length) handlers.current.hear(cmd.rest, true);
        if (cmd.stop) handlers.current.stop();
      };
      e.onError = (code) => setNote({ text: ENGINE_ERROR[code] ?? `Ошибка распознавания: ${code}`, error: true });
      e.onEnd = () => {
        setListening(false);
        setLine('');
      };
      engine.current = e;
    }
    setNote(null);
    setListening(true);
    try {
      engine.current.start();
    } catch {
      setListening(false); // already running in the browser: ignore the extra tap
    }
  };

  // A manual edit hides marks and undo in this very render (the effect above drops the session after it).
  const current = session.current?.written === json;
  // Any UI language: commands are Russian (voice-core grammar), recognition is always ru-RU.
  return { supported: !!speechCtor(), listening, line, note, marks: current ? marks : NO_MARKS, canUndo: current && canUndo, toggle, undo };
}

/**
 * App bar text while voice is in use: what the mic hears (or the title) and a note under it.
 * `hints` (e.g. the sum of tricks) show while listening when there is no other note. Null: show the title.
 */
export function voiceLive(v: Voice, title: string, hints: string[] = []): ReactNode {
  // After stopping only errors stay (no mic access, a rejected last phrase); parser notes go with the mic.
  const own = v.note && (v.listening || v.note.error) ? v.note : null;
  const note = own ?? (v.listening && hints.length ? { text: hints.join('; '), error: false } : null);
  if (!v.supported || (!v.listening && !note)) return null;
  return (
    <div className="voice-live" aria-live="polite">
      <p className={v.listening ? 'voice-line on' : 'voice-line'}>
        <span dir="ltr">{v.listening ? v.line || t.listening : title}</span>
      </p>
      {note && <p className={note.error ? 'voice-note error' : 'voice-note'}>{note.text}</p>}
    </div>
  );
}

/** Undo (after a voice change) and the mic, on the right of the app bar. */
export function VoiceButtons({ voice }: { voice: Voice }) {
  if (!voice.supported) return null;
  return (
    <>
      {voice.canUndo && (
        <button className="appbar-btn" aria-label={t.undo} onClick={voice.undo}>
          <Icon name="undo" />
        </button>
      )}
      <button className={voice.listening ? 'appbar-btn mic on' : 'appbar-btn mic'} aria-label={t.speak} aria-pressed={voice.listening} onClick={voice.toggle}>
        <Icon name="mic" />
      </button>
    </>
  );
}

/** Class for a field the voice set. */
export const marked = (v: Voice, key: string, cls = ''): string => (v.marks.has(key) ? `${cls} voice-mark`.trim() : cls);
