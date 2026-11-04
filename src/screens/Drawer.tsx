import { useState } from 'react';
import { hasFinishedRound, lastRound, type Game } from '../game/model';
import { t } from '../i18n';
import { Button, ConfirmDialog } from '../ui';
import './drawer.css';

export interface DrawerProps {
  game: Game;
  onClose: () => void;
  /** Header button «Таблица очков». */
  onScores: () => void;
  /** Called after «Да» in the confirm dialog. */
  onNewGame: () => void;
  /** Called after «Да» in the confirm dialog. */
  onResetRound: () => void;
  onEdit: (what: 'bids' | 'players' | 'options' | 'scores') => void;
}

export function Drawer({ game, onClose, onScores, onNewGame, onResetRound, onEdit }: DrawerProps) {
  const [ask, setAsk] = useState<'newGame' | 'reset' | null>(null);
  const r = lastRound(game);
  const onRound = r.bidsFixed && !r.finished;
  const items: [label: string, enabled: boolean, go: () => void][] = [
    [t.startNewGame, true, () => setAsk('newGame')],
    [t.resetRound, onRound, () => setAsk('reset')],
    [t.menuEditBids, onRound, () => onEdit('bids')],
    [t.menuEditPlayers, true, () => onEdit('players')],
    [t.menuEditOptions, true, () => onEdit('options')],
    [t.menuEditScores, hasFinishedRound(game), () => onEdit('scores')],
  ];
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer">
        <h2>{t.roundTitle(r.number)}</h2>
        <Button small onClick={onScores}>
          {t.leaderboard}
        </Button>
        <nav>
          {items.map(([label, enabled, go], i) => (
            <div key={i}>
              <button disabled={!enabled} onClick={go}>
                {label}
              </button>
            </div>
          ))}
        </nav>
        {/* Inside the aside so the dialog stacks above the drawer (.scrim z-index 10 < .drawer 11); «Нет» keeps the drawer open. */}
        {ask === 'newGame' && <ConfirmDialog title={t.newGameTitle} text={t.newGameText} onNo={() => setAsk(null)} onYes={onNewGame} />}
        {ask === 'reset' && <ConfirmDialog title={t.resetRoundTitle} text={t.resetRoundText} onNo={() => setAsk(null)} onYes={onResetRound} />}
      </aside>
    </>
  );
}
