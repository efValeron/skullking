import { useState } from 'react';
import { parseName } from '../../voice-core/parser';
import { namesValid, suggestNames } from '../game/model';
import { t } from '../i18n';
import { AppBar, Button, Checkbox } from '../ui';
import { failText } from '../voice/drafts';
import { useSpeech, VoiceBox } from '../voice/Voice';
import './forms.css';

export interface PlayersProps {
  mode: 'create' | 'edit';
  /** Initial names (create: draft, at least the 2 default empty rows). */
  names: string[];
  /** Edit only: «в игре» per player for the current round. */
  inGame?: boolean[];
  /** Name history for autocomplete (suggestNames). */
  history: string[];
  /** «←» in create, «✕» in edit. */
  onBack: () => void;
  /** Create: names only (button «Новая игра»). Edit: names + in-game flags (button «Сохранить»). */
  onSubmit: (names: string[], inGame: boolean[]) => void;
}

const setAt = <T,>(arr: T[], i: number, v: T): T[] => arr.map((x, j) => (j === i ? v : x));

export function PlayersScreen({ mode, names: initialNames, inGame: initialInGame, history, onBack, onSubmit }: PlayersProps) {
  const edit = mode === 'edit';
  const [names, setNames] = useState(initialNames);
  const [inGame, setInGame] = useState(initialInGame ?? []);
  /** Row whose autocomplete list is open. */
  const [open, setOpen] = useState<number | null>(null);

  // Voice (create only): one phrase = one name into the first empty field (or a new row).
  // The form itself is the draft: nothing reaches the game before «Новая игра».
  const target = names.findIndex((n) => !n.trim());
  const [problem, setProblem] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [undo, setUndo] = useState<string[] | null>(null);
  const speech = useSpeech((alts) => {
    const res = parseName(alts, names.filter((n) => n.trim()));
    if (!res.ok) return setProblem(failText(res));
    setProblem(null);
    setNotes(res.warnings);
    const name = res.draft.name;
    if (!name) return; // «готово»
    setUndo(names);
    setNames(target >= 0 ? setAt(names, target, name) : [...names, name]);
  });

  return (
    <>
      <AppBar title={edit ? t.menuEditPlayers : t.newGame} icon={edit ? 'close' : 'back'} onIcon={onBack} />
      <main className={edit ? 'screen players-edit' : 'screen'}>
        <h2 className="section-title">{t.players}</h2>
        {names.map((name, i) => {
          const hints = open === i ? suggestNames(history, name) : [];
          return (
            <div className="player-row" key={i}>
              <input
                className={speech.listening && i === target ? 'name-field voice-target' : 'name-field'}
                value={name}
                placeholder={t.enterName}
                aria-label={`${t.enterName} ${i + 1}`}
                onChange={(e) => {
                  setUndo(null);
                  setNames(setAt(names, i, e.target.value));
                  setOpen(i);
                }}
                onFocus={() => setOpen(i)}
                onBlur={() => setOpen(null)}
              />
              {edit ? (
                <Checkbox hideLabel label={`${t.inGame}: ${i + 1}`} checked={inGame[i] ?? true} onChange={(v) => setInGame(setAt(inGame, i, v))} />
              ) : (
                <button className="circle circle-sm" aria-label={`${t.remove} ${i + 1}`} onClick={() => setNames(names.filter((_, j) => j !== i))}>
                  -
                </button>
              )}
              {hints.length > 0 && (
                <ul className="hints list-reset">
                  {hints.map((h) => (
                    <li key={h}>
                      <button
                        // mousedown + preventDefault: keep focus so blur doesn't close the list before the click
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setNames(setAt(names, i, h));
                          setOpen(null);
                        }}
                      >
                        {h}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        <button className="btn add-bar" aria-label={t.add} disabled={edit} onClick={() => setNames([...names, ''])}>
          +
        </button>
        <Button disabled={!namesValid(names)} onClick={() => onSubmit(names, edit ? names.map((_, i) => inGame[i] ?? true) : names.map(() => true))}>
          {edit ? t.savePlayers : t.newGame}
        </Button>
        {!edit && (
          <VoiceBox
            speech={speech}
            chips={null}
            problem={problem}
            notes={notes}
            onUndo={
              undo &&
              (() => {
                setNames(undo);
                setUndo(null);
              })
            }
          />
        )}
      </main>
    </>
  );
}
