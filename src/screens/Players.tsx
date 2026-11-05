import { useState } from 'react';
import { dealerAfterRemove, namesValid, suggestNames } from '../game/model';
import { t } from '../i18n';
import { AppBar, Button, Checkbox, Icon } from '../ui';
import { failText, fillNames, namesFromVoice } from '../voice/drafts';
import { useSpeech, VoiceBox } from '../voice/Voice';
import './forms.css';

export interface PlayersProps {
  mode: 'create' | 'edit';
  /** Initial names (create: draft, at least the 2 default empty rows). */
  names: string[];
  /** Edit only: «в игре» per player for the current round. */
  inGame?: boolean[];
  /** Create only: who deals first (row index, default 0). */
  dealer?: number;
  /** Name history for autocomplete (suggestNames). */
  history: string[];
  /** «←» in create, «✕» in edit. */
  onBack: () => void;
  /** Create: names + first dealer (button «Новая игра»). Edit: names + in-game flags (button «Сохранить»). */
  onSubmit: (names: string[], inGame: boolean[], dealer: number, order: number[]) => void;
}

const setAt = <T,>(arr: T[], i: number, v: T): T[] => arr.map((x, j) => (j === i ? v : x));
const swap = <T,>(arr: T[], i: number, j: number): T[] => arr.map((x, k) => (k === i ? arr[j]! : k === j ? arr[i]! : x));

export function PlayersScreen({ mode, names: initialNames, inGame: initialInGame, dealer: initialDealer = 0, history, onBack, onSubmit }: PlayersProps) {
  const edit = mode === 'edit';
  const [names, setNames] = useState(initialNames);
  const [inGame, setInGame] = useState(() => initialNames.map((_, i) => initialInGame?.[i] ?? true));
  /** Edit: order[i] = original index of the player now in row i. */
  const [order, setOrder] = useState(() => initialNames.map((_, i) => i));
  const move = (i: number, j: number) => {
    setNames(swap(names, i, j));
    setInGame(swap(inGame, i, j));
    setOrder(swap(order, i, j));
  };
  const [dealer, setDealer] = useState(initialDealer);
  /** Row whose autocomplete list is open. */
  const [open, setOpen] = useState<number | null>(null);

  // Voice (create only): one phrase can hold several names («Аня, Дима и Оля»); they fill the empty
  // fields in order, extra ones add rows. The form itself is the draft: nothing reaches the game before «Новая игра».
  const target = names.findIndex((n) => !n.trim());
  const [problem, setProblem] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [undo, setUndo] = useState<string[] | null>(null);
  const speech = useSpeech((alts) => {
    const res = namesFromVoice(alts, names.filter((n) => n.trim()));
    if (!res.ok) return setProblem(failText(res));
    setProblem(null);
    setNotes(res.warnings);
    if (!res.names.length) return; // just «готово»
    setUndo(names);
    setNames(fillNames(names, res.names));
  });

  return (
    <>
      <AppBar title={edit ? t.menuEditPlayers : t.newGame} icon={edit ? 'close' : 'back'} onIcon={onBack} />
      <main className={edit ? 'screen players-edit' : 'screen'}>
        <h2 className="section-title">{t.players}</h2>
        {!edit && <p className="dealer-hint">{t.dealerHint}</p>}
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
                <>
                  <button className="circle circle-sm quiet" aria-label={`${t.moveUp}: ${i + 1}`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                    <Icon name="up" size={20} />
                  </button>
                  <button className="circle circle-sm quiet" aria-label={`${t.moveDown}: ${i + 1}`} disabled={i === names.length - 1} onClick={() => move(i, i + 1)}>
                    <Icon name="down" size={20} />
                  </button>
                  <Checkbox hideLabel label={`${t.inGame}: ${i + 1}`} checked={inGame[i] ?? true} onChange={(v) => setInGame(setAt(inGame, i, v))} />
                </>
              ) : (
                <>
                  <button
                    className={i === dealer ? 'circle circle-sm dealer-pick on' : 'circle circle-sm dealer-pick'}
                    aria-label={`${t.dealer}: ${i + 1}`}
                    aria-pressed={i === dealer}
                    onClick={() => setDealer(i)}
                  >
                    <Icon name="cards" size={18} />
                  </button>
                  <button
                    className="circle circle-sm"
                    aria-label={`${t.remove} ${i + 1}`}
                    onClick={() => {
                      setNames(names.filter((_, j) => j !== i));
                      setDealer(dealerAfterRemove(dealer, i));
                    }}
                  >
                    -
                  </button>
                </>
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
        <Button disabled={!namesValid(names)} onClick={() => onSubmit(names, edit ? inGame : names.map(() => true), dealer, edit ? order : names.map((_, i) => i))}>
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
