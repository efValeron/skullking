import { useState } from 'react';
import { mergeResults, parseResults, type ResultsDraft } from '../../voice-core/parser';
import { BONUS_PRESETS, canFinish, dealerOf, lastRound, type Game, type PlayerRound, type Round } from '../game/model';
import { t } from '../i18n';
import { AppBar, Button, Checkbox, DealerMark, Icon, Sheet, Stepper } from '../ui';
import { activeNames, failText, resultChips, resultIssues, roundFromDraft, voiceCommand } from '../voice/drafts';
import { useSpeech, VoiceBox } from '../voice/Voice';
import './forms.css';

export interface RoundProps {
  game: Game;
  onMenu: () => void;
  /** Every stepper/bonus/Kraken change of the last round, saved immediately. */
  onChange: (round: Round) => void;
  /** Enabled only when canFinish(lastRound(game)). */
  onFinish: () => void;
}

export function RoundScreen({ game, onMenu, onChange: save, onFinish }: RoundProps) {
  const r = lastRound(game);
  const names = game.playerNames;
  const dealer = dealerOf(game);
  /** Player whose bonus-preset sheet is open. */
  const [sheet, setSheet] = useState<number | null>(null);

  // Voice: tricks/bonus/Kraken phrases build a draft; only «Принять» writes it to the round.
  const [draft, setDraft] = useState<ResultsDraft | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [undo, setUndo] = useState<Round | null>(null);
  const issues = draft ? resultIssues(names, r, draft) : [];
  const blocking = issues.find((i) => i.level === 'error');
  const clearDraft = () => {
    setDraft(null);
    setProblem(null);
    setNotes([]);
  };
  const accept = () => {
    if (!draft || blocking) return;
    setUndo(r);
    save(roundFromDraft(names, r, draft));
    clearDraft();
  };
  const speech = useSpeech((alts) => {
    const cmd = voiceCommand(alts);
    if (cmd === 'accept') return accept();
    if (cmd === 'cancel') return clearDraft();
    const res = parseResults(alts, activeNames(names, r), { cards: r.cardsInRound });
    if (!res.ok) return setProblem(failText(res));
    setProblem(null);
    setNotes(res.warnings);
    setUndo(null);
    setDraft((d) => (d ? mergeResults(d, res.draft) : res.draft));
  });

  /** Manual edits make the voice undo stale. */
  const onChange = (next: Round) => {
    setUndo(null);
    save(next);
  };
  const setPlayer = (i: number, patch: Partial<PlayerRound>) => onChange({ ...r, players: r.players.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  return (
    <>
      <AppBar icon="menu" onIcon={onMenu} title={t.roundTitle(r.number)} />
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
                <span>{p.bid}</span>
                <Stepper label={`${name}: ${t.tricks}`} value={p.trick} max={r.cardsInRound} disabled={p.away} onChange={(trick) => setPlayer(i, { trick })} />
                <Stepper label={`${name}: ${t.bonus}`} value={p.bonus} step={10} disabled={p.away} onChange={(bonus) => setPlayer(i, { bonus })} />
                <button className="circle circle-sm" aria-label={`${name}: ★`} disabled={p.away} onClick={() => setSheet(i)}>
                  <Icon name="star" size={18} />
                </button>
              </div>
            </div>
          );
        })}
        <Checkbox label={t.kraken} checked={r.kraken} onChange={(kraken) => onChange({ ...r, kraken })} />
        <Button disabled={!canFinish(r)} onClick={onFinish}>
          {t.finishRound}
        </Button>
        <VoiceBox
          speech={speech}
          chips={draft && resultChips(names, r, draft)}
          problem={problem ?? blocking?.msg}
          notes={[...notes, ...issues.filter((i) => i.level === 'warn').map((i) => i.msg)]}
          blocked={!!blocking}
          onAccept={accept}
          onCancel={clearDraft}
          onUndo={
            undo &&
            (() => {
              save(undo);
              setUndo(null);
            })
          }
        />
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
