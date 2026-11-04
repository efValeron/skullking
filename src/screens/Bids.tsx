import { useState } from 'react';
import { mergeBids, parseBids, type BidsDraft } from '../../voice-core/parser';
import { lastRound, type Game } from '../game/model';
import { t } from '../i18n';
import { AppBar, Button, Card, Stepper } from '../ui';
import { activeNames, bidsChips, bidsFromDraft, failText, voiceCommand } from '../voice/drafts';
import { useSpeech, VoiceBox } from '../voice/Voice';
import './forms.css';

export type BidsProps =
  | { mode: 'before'; game: Game; onMenu: () => void; onSubmit: (bids: number[]) => void; onClose?: never }
  | { mode: 'edit'; game: Game; onClose: () => void; onSubmit: (bids: number[]) => void; onMenu?: never };

export function BidsScreen(props: BidsProps) {
  const { game, onSubmit } = props;
  const before = props.mode === 'before';
  const r = lastRound(game);
  const names = game.playerNames;
  const [bids, setBids] = useState(() => r.players.map((p) => p.bid));

  // Voice: phrases build a draft; «Принять» copies it into the steppers (still not the game).
  const [draft, setDraft] = useState<BidsDraft | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [undo, setUndo] = useState<number[] | null>(null);
  const clearDraft = () => {
    setDraft(null);
    setProblem(null);
    setNotes([]);
  };
  const accept = () => {
    if (!draft) return;
    setUndo(bids);
    setBids(bidsFromDraft(names, r, draft));
    clearDraft();
  };
  const speech = useSpeech((alts) => {
    const cmd = voiceCommand(alts);
    if (cmd === 'accept') return accept();
    if (cmd === 'cancel') return clearDraft();
    const res = parseBids(alts, activeNames(names, r), { cards: r.cardsInRound });
    if (!res.ok) return setProblem(failText(res));
    setProblem(null);
    setNotes(res.warnings);
    setUndo(null);
    setDraft((d) => (d ? mergeBids(d, res.draft) : res.draft));
  });

  const blocks = r.players.map((p, i) => {
    const name = names[i]!;
    return (
      <div className="bid-block" key={i}>
        <h2 className="player-name">{name}</h2>
        <Stepper
          label={name}
          value={bids[i]!}
          max={r.cardsInRound}
          disabled={p.away}
          onChange={(v) => {
            setUndo(null);
            setBids(bids.map((b, j) => (j === i ? v : b)));
          }}
        />
      </div>
    );
  });

  return (
    <>
      <AppBar icon={before ? 'menu' : 'close'} onIcon={props.onMenu ?? props.onClose} title={before ? t.bidsTitle(r.number) : t.editBidsTitle(r.number)} />
      <main className={before ? 'screen bids' : 'screen bids bids-edit'}>
        {r.players.length > 5 ? <div className="grid2">{blocks}</div> : <div className="bid-list">{blocks}</div>}
        <Card>{t.bidsInGame(bids.reduce((s, b) => s + b, 0), r.cardsInRound)}</Card>
        <Button onClick={() => onSubmit(bids)}>{before ? t.startRound : t.saveBids}</Button>
        <VoiceBox
          speech={speech}
          chips={draft && bidsChips(names, r, draft)}
          problem={problem}
          notes={notes}
          onAccept={accept}
          onCancel={clearDraft}
          onUndo={
            undo &&
            (() => {
              setBids(undo);
              setUndo(null);
            })
          }
        />
      </main>
    </>
  );
}
