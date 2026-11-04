// «Говорить» button + draft panel shared by the three voice windows (names, bids, round results).
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { Button } from '../ui';
import { createWebSpeechEngine, speechCtor, type SpeechEngine } from './engine';
import { ENGINE_ERROR } from './drafts';
import './voice.css';

export interface Speech {
  supported: boolean;
  listening: boolean;
  interim: string;
  error: string | null;
  toggle: () => void;
}

/** Mic is on only between a tap on «Говорить» and the end of one phrase (no wake word). */
export function useSpeech(onPhrase: (alternatives: string[]) => void): Speech {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const engine = useRef<SpeechEngine | null>(null);
  const handler = useRef(onPhrase);
  handler.current = onPhrase;
  useEffect(() => () => engine.current?.stop(), []);

  const toggle = () => {
    if (listening) return engine.current?.stop();
    if (!engine.current) {
      const e = createWebSpeechEngine('ru-RU');
      if (!e) return;
      e.onInterim = setInterim;
      e.onResult = (alts) => {
        setInterim('');
        handler.current(alts);
      };
      e.onError = (code) => code !== 'aborted' && setError(ENGINE_ERROR[code] ?? `Ошибка распознавания: ${code}`);
      e.onEnd = () => {
        setListening(false);
        setInterim('');
      };
      engine.current = e;
    }
    setError(null);
    setListening(true);
    try {
      engine.current.start();
    } catch {
      setListening(false); // already running in the browser: ignore the extra tap
    }
  };

  return { supported: t.voice && !!speechCtor(), listening, interim, error, toggle };
}

const MIC = 'M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z';

export interface VoiceBoxProps {
  speech: Speech;
  /** Draft as chips; null when there is no draft. */
  chips: string[] | null;
  /** Rejected phrase or blocking problem (shown in red). */
  problem?: string | null;
  /** Non-blocking notes (similar names, bonus that won't count). */
  notes?: string[];
  /** Accept disabled (e.g. tricks don't add up). */
  blocked?: boolean;
  onAccept?: () => void;
  onCancel?: () => void;
  /** Undo the last accepted draft. */
  onUndo?: (() => void) | null;
}

export function VoiceBox({ speech, chips, problem, notes = [], blocked, onAccept, onCancel, onUndo }: VoiceBoxProps) {
  if (!speech.supported) return null;
  const message = problem ?? speech.error;
  return (
    <section className="voice" aria-label={t.speak}>
      <button className={speech.listening ? 'btn btn-voice listening' : 'btn btn-voice'} onClick={speech.toggle} aria-pressed={speech.listening}>
        <svg className="icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path d={MIC} fill="currentColor" />
        </svg>
        <span>{speech.listening ? t.listening : t.speak}</span>
      </button>
      {speech.interim && <p className="voice-interim">{speech.interim}</p>}
      {chips && (
        <div className="voice-draft card" role="status">
          <ul className="voice-chips">
            {chips.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
          {onAccept && (
            <div className="voice-actions">
              <Button small onClick={onCancel ?? (() => {})}>
                {t.cancel}
              </Button>
              <Button small disabled={blocked} onClick={onAccept}>
                {t.accept}
              </Button>
            </div>
          )}
        </div>
      )}
      {notes.map((n, i) => (
        <p key={i} className="voice-note">
          {n}
        </p>
      ))}
      {message && (
        <p className="voice-problem" role="alert">
          {message}
        </p>
      )}
      {onUndo && (
        <Button small onClick={onUndo}>
          {t.undo}
        </Button>
      )}
    </section>
  );
}
