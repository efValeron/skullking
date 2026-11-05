import { useState } from 'react';
import { dealerOf, lastRound, type Game } from '../game/model';
import { t } from '../i18n';
import { AppBar, Button, Card, DealerMark, Stepper } from '../ui';
import { applyBids } from '../voice/drafts';
import { useVoice, VoiceButtons, voiceLive } from '../voice/Voice';
import './forms.css';

export type BidsProps =
  | { mode: 'before'; game: Game; onMenu: () => void; onSubmit: (bids: number[]) => void; onClose?: never }
  | { mode: 'edit'; game: Game; onClose: () => void; onSubmit: (bids: number[]) => void; onMenu?: never };

export function BidsScreen(props: BidsProps) {
  const { game, onSubmit } = props;
  const before = props.mode === 'before';
  const r = lastRound(game);
  const names = game.playerNames;
  const dealer = dealerOf(game);
  const [bids, setBids] = useState(() => r.players.map((p) => p.bid));

  // Voice writes into the steppers (highlighted); the game gets the bids only on «Начать раунд».
  const voice = useVoice(bids, setBids, applyBids(names, r));

  const title = before ? t.bidsTitle(r.number) : t.editBidsTitle(r.number);
  const blocks = r.players.map((p, i) => {
    const name = names[i]!;
    return (
      <div className="bid-block" key={i}>
        <h2 className="player-name">
          {name}
          {i === dealer && <DealerMark />}
        </h2>
        <Stepper
          label={name}
          value={bids[i]!}
          max={r.cardsInRound}
          disabled={p.away}
          mark={voice.marks.has(`bid:${i}`)}
          onChange={(v) => setBids(bids.map((b, j) => (j === i ? v : b)))}
        />
      </div>
    );
  });

  return (
    <>
      <AppBar icon={before ? 'menu' : 'close'} onIcon={props.onMenu ?? props.onClose} title={title} live={voiceLive(voice, title)}>
        <VoiceButtons voice={voice} />
      </AppBar>
      <main className={before ? 'screen bids' : 'screen bids bids-edit'}>
        {r.players.length > 5 ? <div className="grid2">{blocks}</div> : <div className="bid-list">{blocks}</div>}
        <Card>{t.bidsInGame(bids.reduce((s, b) => s + b, 0), r.cardsInRound)}</Card>
        <Button onClick={() => onSubmit(bids)}>{before ? t.startRound : t.saveBids}</Button>
      </main>
    </>
  );
}
