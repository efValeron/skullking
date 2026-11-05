import { useRef, useState } from 'react';
import {
  canFinish,
  cardsFor,
  expectedTricks,
  isGameFinished,
  normalizeFinished,
  runningTotals,
  tricksTaken,
  type Game,
  type PlayerRound,
  type Round,
} from '../game/model';
import { t } from '../i18n';
import { sharePng } from '../share';
import { AppBar, Button, Card, Checkbox, Sheet, Stepper } from '../ui';
import './scores.css';

/**
 * finish: main screen after «Завершить раунд» (≡, button «Следующий раунд» or «Начать новую игру» when isGameFinished).
 * show:   from the drawer button «Таблица очков» (✕, no bottom button).
 * results:from the start list «Результаты» (✕, no bottom button).
 * edit:   «Редактировать очки за раунды» (✕, cell sheet, «Сохранить»).
 */
export type ScoresProps =
  | { mode: 'finish'; game: Game; onMenu: () => void; onNextRound: () => void; onNewGame: () => void }
  | { mode: 'show' | 'results'; game: Game; onClose: () => void }
  | { mode: 'edit'; game: Game; onClose: () => void; onSave: (rounds: Round[]) => void };

/** Cell being edited in the sheet: round index, player index and the draft values. */
type Draft = { k: number; i: number; p: PlayerRound; kraken: boolean };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function ScoresScreen(props: ScoresProps) {
  const { game } = props;
  const edit = props.mode === 'edit';
  const orig = game.rounds;
  const [working, setWorking] = useState(orig);
  const [draft, setDraft] = useState<Draft | null>(null);

  const rounds = edit ? working : orig;
  const totals = runningTotals(rounds, game.playerNames.length);
  const invalid = edit ? rounds.filter((r) => r.finished && !canFinish(r)) : [];
  const numbers = Array.from({ length: game.totalRounds - game.startRound + 1 }, (_, j) => game.startRound + j);

  const cellChanged = (k: number, i: number) => !same(working[k]?.players[i], orig[k]?.players[i]);
  const put = (k: number, i: number, p: PlayerRound, kraken: boolean) => {
    setWorking((rs) => rs.map((r, j) => (j === k ? { ...r, kraken, players: r.players.map((x, m) => (m === i ? p : x)) } : r)));
    setDraft(null);
  };
  const sheetRound = draft && working[draft.k]!;
  const tableRef = useRef<HTMLTableElement>(null);
  // End of game (or its results from the start list): the table can go out as a picture.
  const shareable = (props.mode === 'finish' && isGameFinished(game)) || props.mode === 'results';
  const narrow = game.playerNames.length > 4; // «№» header and a 25px first column, as in the original

  return (
    <>
      <AppBar
        title={edit ? t.menuEditScores : t.leaderboard}
        icon={props.mode === 'finish' ? 'menu' : 'close'}
        onIcon={props.mode === 'finish' ? props.onMenu : props.onClose}
      />
      <main className="screen scores-screen">
        {edit && (
          <Card>
            <p>{t.tapHint}</p>
            {!same(working, orig) && (
              <Button small outline onClick={() => setWorking(orig)}>
                {t.revertChanges}
              </Button>
            )}
            {invalid.map((r) => (
              <p key={r.number} className="error">
                {t.tricksInRound(r.number, tricksTaken(r), expectedTricks(r))}
              </p>
            ))}
          </Card>
        )}

        <div className="scores-sheet">
        <table ref={tableRef} className={narrow ? 'scores narrow' : 'scores'}>
          <thead>
            <tr>
              <th scope="col">{narrow ? t.numberColumn : t.round}</th>
              {game.playerNames.map((name, i) => (
                <th key={i} scope="col">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {numbers.map((n) => {
              const k = n - game.startRound;
              const r = rounds[k];
              const cards = r?.cardsInRound ?? cardsFor(n, game.maxCards); // future rows show the limit too (original screen 54)
              const cls = [k === rounds.length - 1 && 'current', r && invalid.includes(r) && 'invalid'].filter(Boolean).join(' ');
              return (
                <tr key={n} className={cls || undefined}>
                  <th scope="row" title={t.roundCards(n, cards)}>
                    {n}
                    {cards !== n && <div className="frac">{cards}</div>}
                  </th>
                  {game.playerNames.map((name, i) => {
                    const p = r?.finished ? r.players[i] : undefined;
                    // Away player: values blank, running total still shown (the original showed «-»).
                    const body = p && (
                      <>
                        <span className="sub">
                          <span>{p.away ? '' : p.bid}</span>
                          <span>{p.away ? '' : p.trick}</span>
                          <span>{p.away || !p.bonus ? '' : p.bonus}</span>
                        </span>
                        <span className="total">{totals[k]?.[i]}</span>
                      </>
                    );
                    return (
                      <td
                        key={i}
                        data-round={n}
                        data-player={i}
                        className={edit && p && cellChanged(k, i) ? 'changed' : undefined}
                        title={p?.away ? t.playerOut : undefined}
                      >
                        {edit && p ? (
                          <button aria-label={`${name} ${n}`} onClick={() => setDraft({ k, i, p, kraken: r!.kraken })}>
                            {body}
                          </button>
                        ) : (
                          body
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>

        {props.mode === 'finish' &&
          (isGameFinished(game) ? (
            <Button onClick={props.onNewGame}>{t.startNewGame}</Button>
          ) : (
            <Button onClick={props.onNextRound}>{t.nextRound}</Button>
          ))}
        {shareable && (
          <Button outline onClick={() => tableRef.current && sharePng(tableRef.current, `skull-king-${game.startDate.slice(0, 10)}.png`)}>
            {t.share}
          </Button>
        )}
        {props.mode === 'edit' && (
          <Button disabled={invalid.length > 0} onClick={() => props.onSave(working.map((r) => (r.finished ? normalizeFinished(r) : r)))}>
            {t.saveScore}
          </Button>
        )}
      </main>

      {draft && sheetRound && (
        <Sheet onClose={() => setDraft(null)}>
          <div className="cell-sheet">
            <h2>{t.roundTitle(sheetRound.number)}</h2>
            <Checkbox label={t.kraken} checked={draft.kraken} onChange={(kraken) => setDraft({ ...draft, kraken })} />
            <h2>{game.playerNames[draft.i]}</h2>
            {(
              [
                ['bid', t.bids, sheetRound.cardsInRound, 1],
                ['trick', t.tricks, sheetRound.cardsInRound, 1],
                ['bonus', t.bonus, Infinity, 10],
              ] as const
            ).map(([key, label, max, step]) => (
              <div key={key}>
                <div>{label}</div>
                <Stepper label={label} value={draft.p[key]} max={max} step={step} onChange={(v) => setDraft({ ...draft, p: { ...draft.p, [key]: v } })} />
              </div>
            ))}
            <Button onClick={() => put(draft.k, draft.i, draft.p, draft.kraken)}>{t.apply}</Button>
            {(cellChanged(draft.k, draft.i) || sheetRound.kraken !== orig[draft.k]?.kraken) && (
              <Button onClick={() => put(draft.k, draft.i, orig[draft.k]!.players[draft.i]!, orig[draft.k]!.kraken)}>{t.revert}</Button>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
