import { useState } from 'react';
import { BONUS_PRESETS, canFinish, dealerOf, lastRound, type Game, type PlayerRound, type Round } from '../game/model';
import { t } from '../i18n';
import { AppBar, Button, Checkbox, DealerMark, Icon, Sheet, Stepper } from '../ui';
import { applyResults, roundIssues } from '../voice/drafts';
import { useVoice, VoiceButtons, voiceLive } from '../voice/Voice';
import './forms.css';

export interface RoundProps {
  game: Game;
  onMenu: () => void;
  /** Every stepper/bonus/Kraken change of the last round, saved immediately. */
  onChange: (round: Round) => void;
  /** Enabled only when canFinish(lastRound(game)). */
  onFinish: () => void;
}

export function RoundScreen({ game, onMenu, onChange, onFinish }: RoundProps) {
  const r = lastRound(game);
  const names = game.playerNames;
  const dealer = dealerOf(game);
  /** Player whose bonus-preset sheet is open. */
  const [sheet, setSheet] = useState<number | null>(null);

  // Voice writes tricks, bonus and Kraken into the open round, like the steppers do (highlighted);
  // the round ends only on «Завершить раунд».
  const voice = useVoice(r, onChange, applyResults(names));
  const title = t.roundTitle(r.number);
  const setPlayer = (i: number, patch: Partial<PlayerRound>) => onChange({ ...r, players: r.players.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  return (
    <>
      <AppBar icon="menu" onIcon={onMenu} title={title} live={voiceLive(voice, title, roundIssues(names, r).map((i) => i.msg))}>
        <VoiceButtons voice={voice} />
      </AppBar>
      <main className="screen round">
        {r.players.map((p, i) => {
          const name = game.playerNames[i]!;
          return (
            <div className="round-block" key={i}>
              <h2 className="player-name">
                {name}
                {i === dealer && <DealerMark />}
              </h2>
              <div className="round-row round-labels">
                <span>{t.bids}</span> <span>{t.tricks}</span> <span>{t.bonus}</span>
              </div>
              <div className="round-row">
                <span className="stepper-value">{p.bid}</span>
                <Stepper label={`${name}: ${t.tricks}`} value={p.trick} max={r.cardsInRound} disabled={p.away} mark={voice.marks.has(`trick:${i}`)} onChange={(trick) => setPlayer(i, { trick })} />
                <Stepper label={`${name}: ${t.bonus}`} value={p.bonus} step={10} disabled={p.away} mark={voice.marks.has(`bonus:${i}`)} onChange={(bonus) => setPlayer(i, { bonus })} />
                <button className="circle circle-sm" aria-label={`${name}: ★`} disabled={p.away} onClick={() => setSheet(i)}>
                  <Icon name="star" size={18} />
                </button>
              </div>
            </div>
          );
        })}
        <Checkbox label={t.kraken} checked={r.kraken} mark={voice.marks.has('kraken')} onChange={(kraken) => onChange({ ...r, kraken })} />
        <Button disabled={!canFinish(r)} onClick={onFinish}>
          {t.finishRound}
        </Button>
      </main>
      {sheet != null && (
        <Sheet onClose={() => setSheet(null)}>
          <ul className="bonus-list list-reset">
            {BONUS_PRESETS.map(({ key, pts }) => (
              <li key={key}>
                <button
                  onClick={() => {
                    setPlayer(sheet, { bonus: r.players[sheet]!.bonus + pts });
                    setSheet(null);
                  }}
                >
                  <span className="bonus-label">{t.bonusPreset[key]}</span> <span className="bonus-pts">{`+${pts}`}</span>
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </>
  );
}
