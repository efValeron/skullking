import { isGameFinished, lastRound, type Game } from '../game/model';
import { formatDate, t } from '../i18n';
import { AppBar, Button } from '../ui';
import './forms.css';

export interface StartProps {
  /** Oldest first (storage order); show newest first. */
  games: Game[];
  onNewGame: () => void;
  /** Index into `games`. */
  onContinue: (index: number) => void;
  onResults: (index: number) => void;
}

export function StartScreen({ games, onNewGame, onContinue, onResults }: StartProps) {
  const newestFirst = games.map((g, i) => ({ g, i })).reverse();
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
            </div>
          );
        })}
        <Button onClick={onNewGame}>{t.startNewGame}</Button>
      </main>
    </>
  );
}
