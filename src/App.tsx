// App shell: state, persistence and navigation. Screens are dumb: props in, callbacks out.
import { useEffect, useRef, useState } from 'react';
import {
  applyOptions,
  applyPlayers,
  createGame,
  lastRound,
  mergeNames,
  nextRound,
  normalizeFinished,
  resetRound,
  setBids,
  updateLast,
  type Game,
  type Options,
  type Round,
} from './game/model';
import { loadGames, loadNames, saveGames, saveNames } from './game/storage';
import { StartScreen } from './screens/Start';
import { PlayersScreen } from './screens/Players';
import { OptionsScreen } from './screens/Options';
import { BidsScreen } from './screens/Bids';
import { RoundScreen } from './screens/Round';
import { ScoresScreen } from './screens/Scores';
import { Drawer } from './screens/Drawer';

/** `game` is the main game screen; which one depends on the last round's state. */
type Route =
  | { to: 'start' }
  | { to: 'players'; edit?: boolean }
  | { to: 'options'; edit?: boolean }
  | { to: 'game' }
  | { to: 'bidsEdit' }
  | { to: 'scores'; mode: 'show' | 'edit' | 'results' };

export function App() {
  const [games, setGames] = useState<Game[]>(loadGames);
  const [names, setNames] = useState<string[]>(loadNames);
  const [cur, setCur] = useState<number | null>(null);
  const [draft, setDraft] = useState<string[]>(['', '']);
  const [draftDealer, setDraftDealer] = useState(0);
  const [stack, setStack] = useState<Route[]>([{ to: 'start' }]);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => saveGames(games), [games]);
  useEffect(() => saveNames(names), [names]);

  // Browser/system Back pops one screen; on a root screen it does nothing (like the original).
  const depth = useRef(1);
  depth.current = stack.length;
  useEffect(() => {
    const onPop = () => {
      if (depth.current > 1) setStack((s) => s.slice(0, -1));
      else history.pushState(null, '');
      setDrawer(false);
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  const push = (r: Route) => {
    history.pushState(null, '');
    setStack((s) => [...s, r]);
  };
  const back = () => history.back();
  const reset = (...rs: Route[]) => {
    rs.slice(1).forEach(() => history.pushState(null, ''));
    setStack(rs);
    setDrawer(false);
  };

  const game = cur == null ? null : games[cur]!;
  const update = (fn: (g: Game) => Game) => setGames((gs) => gs.map((g, i) => (i === cur ? fn(g) : g)));

  const newGame = () => {
    setDraft(['', '']);
    setDraftDealer(0);
    setCur(null);
    reset({ to: 'start' }, { to: 'players' });
  };
  const startGame = (o: Options) => {
    const g = createGame(draft.map((n) => n.trim()), o, new Date(), draftDealer);
    setNames((h) => mergeNames(h, g.playerNames));
    setCur(games.length);
    setGames((gs) => [...gs, g]);
    reset({ to: 'game' });
  };

  const route = stack[stack.length - 1]!;
  const menu = () => setDrawer(true);

  const render = (route: Route) => {
    switch (route.to) {
      case 'start':
        return (
          <StartScreen
            games={games}
            onNewGame={() => {
              setDraft(['', '']);
              setDraftDealer(0);
              push({ to: 'players' });
            }}
            onContinue={(i) => {
              setCur(i);
              reset({ to: 'game' });
            }}
            onResults={(i) => {
              setCur(i);
              push({ to: 'scores', mode: 'results' });
            }}
          />
        );
      case 'players':
        if (route.edit && game)
          return (
            <PlayersScreen
              mode="edit"
              names={game.playerNames}
              inGame={lastRound(game).players.map((p) => !p.away)}
              history={names}
              onBack={back}
              onSubmit={(raw, inGame, _dealer, order) => {
                const n = raw.map((s) => s.trim());
                update((g) => applyPlayers(g, n, inGame, order));
                setNames((h) => mergeNames(h, n));
                back();
              }}
            />
          );
        return (
          <PlayersScreen
            mode="create"
            names={draft}
            dealer={draftDealer}
            history={names}
            onBack={back}
            onSubmit={(n, _inGame, d) => {
              setDraft(n);
              setDraftDealer(d);
              push({ to: 'options' });
            }}
          />
        );
      case 'options':
        if (route.edit && game)
          return (
            <OptionsScreen
              mode="edit"
              players={game.playerNames.length}
              initial={game}
              minRounds={Math.max(game.startRound, lastRound(game).number)}
              onBack={back}
              onSubmit={(o) => {
                update((g) => applyOptions(g, o));
                back();
              }}
            />
          );
        return (
          <OptionsScreen
            mode="create"
            players={draft.length}
            initial={{ totalRounds: 10, startRound: 1, maxCards: null }}
            minRounds={1}
            onBack={back}
            onSubmit={startGame}
          />
        );
      case 'bidsEdit':
        if (!game) return null;
        return (
          <BidsScreen
            mode="edit"
            game={game}
            onClose={back}
            onSubmit={(bids) => {
              update((g) => updateLast(g, (r) => setBids(r, bids)));
              back();
            }}
          />
        );
      case 'scores':
        if (!game) return null;
        return (
          <ScoresScreen
            mode={route.mode}
            game={game}
            onClose={back}
            onSave={(rounds: Round[]) => {
              update((g) => ({ ...g, rounds }));
              back();
            }}
          />
        );
      case 'game': {
        if (!game) return null;
        const r = lastRound(game);
        if (!r.bidsFixed)
          return (
            <BidsScreen
              // shortcut: unsaved bids reset after renaming/reordering players mid-bidding (they're indexed by row)
              key={game.playerNames.join('\n')}
              mode="before"
              game={game}
              onMenu={menu}
              onSubmit={(bids) => update((g) => updateLast(g, (x) => ({ ...setBids(x, bids), bidsFixed: true })))}
            />
          );
        if (!r.finished)
          return (
            <RoundScreen
              game={game}
              onMenu={menu}
              onChange={(next) => update((g) => updateLast(g, () => next))}
              onFinish={() => update((g) => updateLast(g, normalizeFinished))}
            />
          );
        return <ScoresScreen mode="finish" game={game} onMenu={menu} onNextRound={() => update(nextRound)} onNewGame={newGame} />;
      }
    }
  };

  // Screens below the top stay mounted (hidden), like Flutter routes: unsaved bids/names survive a modal.
  return (
    <>
      {stack.map((r, i) => (
        <div key={i} hidden={i < stack.length - 1}>
          {render(r)}
        </div>
      ))}
      {drawer && game && route.to === 'game' && (
        <Drawer
          game={game}
          onClose={() => setDrawer(false)}
          onScores={() => {
            setDrawer(false);
            push({ to: 'scores', mode: 'show' });
          }}
          onNewGame={newGame}
          onResetRound={() => {
            update(resetRound);
            setDrawer(false);
          }}
          onEdit={(what) => {
            setDrawer(false);
            push(what === 'bids' ? { to: 'bidsEdit' } : what === 'players' ? { to: 'players', edit: true } : what === 'options' ? { to: 'options', edit: true } : { to: 'scores', mode: 'edit' });
          }}
        />
      )}
    </>
  );
}
