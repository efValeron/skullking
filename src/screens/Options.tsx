import { useState } from 'react';
import { cardsNeeded, effectiveMaxCards, type Options } from '../game/model';
import { DECK_LABEL, t } from '../i18n';
import { AppBar, Button, Card, Stepper } from '../ui';
import './forms.css';

export interface OptionsProps {
  mode: 'create' | 'edit';
  players: number;
  initial: Options;
  /** Lowest allowed «Раунды» (create: 1; edit: max(startRound, current round number)). Also never below startRound. */
  minRounds: number;
  /** «←» in create, «✕» in edit. */
  onBack: () => void;
  /** maxCards must come from effectiveMaxCards(). */
  onSubmit: (o: Options) => void;
}

export function OptionsScreen({ mode, players, initial, minRounds, onBack, onSubmit }: OptionsProps) {
  const create = mode === 'create';
  const [totalRounds, setTotalRounds] = useState(initial.totalRounds);
  const [startRound, setStartRound] = useState(initial.startRound);
  const [limit, setLimit] = useState(initial.maxCards);
  // A number exactly when the deck is short (cardsNeeded > DECK_SIZE).
  const maxCards = effectiveMaxCards(players, totalRounds, limit);

  return (
    <>
      <AppBar title={create ? t.gameOptions : t.menuEditOptions} icon={create ? 'back' : 'close'} onIcon={onBack} />
      <main className={create ? 'screen options' : 'screen options options-edit'}>
        <div className="opt-label">{t.rounds}</div>
        <Stepper
          label={t.rounds}
          value={totalRounds}
          min={Math.max(minRounds, startRound)}
          onChange={(v) => {
            if (v !== totalRounds) setLimit(null); // the original drops the chosen limit when rounds change
            setTotalRounds(v);
          }}
        />
        {create && (
          <>
            <div className="opt-label">{t.startFrom}</div>
            <Stepper label={t.startFrom} value={startRound} min={1} max={totalRounds} onChange={setStartRound} />
          </>
        )}
        {maxCards != null && (
          <Card>
            <p>{t.needCards(cardsNeeded(players, totalRounds), DECK_LABEL)}</p>
            <p>{t.limitCards(maxCards, players * maxCards)}</p>
            <Stepper label="maxCards" value={maxCards} min={1} max={totalRounds} onChange={setLimit} />
          </Card>
        )}
        <Button onClick={() => onSubmit({ totalRounds, startRound, maxCards })}>{create ? t.startGame : t.saveOptions}</Button>
      </main>
    </>
  );
}
