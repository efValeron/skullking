import { useState } from 'react';
import { isGameFinished, lastRound, type Game } from '../game/model';
import { formatDate, t } from '../i18n';
import { AppBar, Button, ConfirmDialog, Icon } from '../ui';
import './forms.css';

export interface StartProps {
  /** Oldest first (storage order); show newest first. */
  games: Game[];
  onNewGame: () => void;
  /** Index into `games`. */
  onContinue: (index: number) => void;
  onResults: (index: number) => void;
  /** Index into `games`; asked for confirmation first. Not in the original. */
  onDelete: (index: number) => void;
}

export function StartScreen({ games, onNewGame, onContinue, onResults, onDelete }: StartProps) {
  const newestFirst = games.map((g, i) => ({ g, i })).reverse();
  const [ask, setAsk] = useState<number | null>(null);
  const asked = ask === null ? null : games[ask];
  return (
    <>
      <AppBar title={t.appTitle} />
      <main className={games.length > 0 ? 'screen' : 'screen start-empty'}>
        {games.length > 0 && <h2 className="section-title">{t.previousGames}</h2>}
        {newestFirst.map(({ g, i }) => {
          const done = isGameFinished(g);
          return (
            <div className="game" key={i}>
              <div className="game-info">
                <div className="game-status">{done ? t.gameFinished : t.roundTitle(lastRound(g).number)}</div>
                <div className="game-date">{formatDate(g.startDate)}</div>
                <div className="game-names">{g.playerNames.join(', ')}</div>
              </div>
              <Button small outline onClick={() => (done ? onResults(i) : onContinue(i))}>
                {done ? t.results : t.continue}
              </Button>
              <button className="circle circle-sm game-delete" aria-label={t.deleteGame} onClick={() => setAsk(i)}>
                <Icon name="trash" size={16} />
              </button>
            </div>
          );
        })}
        <Button onClick={onNewGame}>{t.startNewGame}</Button>
      </main>
      {asked && (
        <ConfirmDialog
          title={t.deleteGameTitle}
          text={t.deleteGameText(formatDate(asked.startDate), asked.playerNames.join(', '))}
          onNo={() => setAsk(null)}
          onYes={() => {
            onDelete(ask!);
            setAsk(null);
          }}
        />
      )}
    </>
  );
}
