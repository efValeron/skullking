import { useState, type ReactNode } from 'react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { dealerAfterRemove, duplicateNames, namesValid, suggestNames } from '../game/model';
import { t } from '../i18n';
import { AppBar, Button, Checkbox, Icon } from '../ui';
import { applyNames } from '../voice/drafts';
import { marked, useVoice, VoiceButtons, voiceLive } from '../voice/Voice';
import './forms.css';

export interface PlayersProps {
  mode: 'create' | 'edit';
  /** Initial names (create: draft, at least the 2 default empty rows). */
  names: string[];
  /** Edit only: «в игре» per player for the current round. */
  inGame?: boolean[];
  /** Create only: who deals first (row index, default 0). */
  dealer?: number;
  /** Name history for autocomplete (suggestNames). */
  history: string[];
  /** «←» in create, «✕» in edit. */
  onBack: () => void;
  /** Create: names + first dealer (button «Новая игра»). Edit: names + in-game flags (button «Сохранить»). */
  onSubmit: (names: string[], inGame: boolean[], dealer: number, order: number[]) => void;
}

const setAt = <T,>(arr: T[], i: number, v: T): T[] => arr.map((x, j) => (j === i ? v : x));

/** A player row; in edit mode it is dragged by its handle (the name field stays a normal input). */
function Row({ id, sortable, label, children }: { id: string; sortable: boolean; label: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !sortable,
    transition: { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
  });
  return (
    <div ref={setNodeRef} className={isDragging ? 'player-row dragging' : 'player-row'} style={{ transform: CSS.Translate.toString(transform), transition }}>
      {sortable && (
        <button ref={setActivatorNodeRef} className="drag-handle" {...attributes} {...listeners} aria-label={label}>
          <Icon name="drag" />
        </button>
      )}
      {children}
    </div>
  );
}

export function PlayersScreen({ mode, names: initialNames, inGame: initialInGame, dealer: initialDealer = 0, history, onBack, onSubmit }: PlayersProps) {
  const edit = mode === 'edit';
  const [names, setNames] = useState(initialNames);
  const [inGame, setInGame] = useState(() => initialNames.map((_, i) => initialInGame?.[i] ?? true));
  /** Edit: order[i] = original index of the player now in row i. */
  const [order, setOrder] = useState(() => initialNames.map((_, i) => i));
  // Drag to reorder (edit): row ids are the players' original indexes, so rows keep their identity while moving.
  const ids = names.map((_, i) => String(edit ? order[i] : i));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    setNames(arrayMove(names, from, to));
    setInGame(arrayMove(inGame, from, to));
    setOrder(arrayMove(order, from, to));
  };
  const [dealer, setDealer] = useState(initialDealer);
  /** Row whose autocomplete list is open. */
  const [open, setOpen] = useState<number | null>(null);

  // Voice (create only): one phrase can hold several names («Аня, Дима и Оля»); they fill the empty
  // fields in order, extra ones add rows. The form itself is the draft: nothing reaches the game before «Новая игра».
  const target = names.findIndex((n) => !n.trim());
  const voice = useVoice(names, setNames, applyNames);
  const title = edit ? t.menuEditPlayers : t.newGame;
  /** Same name twice: red fields, «Новая игра» / «Сохранить» stay off. */
  const dups = duplicateNames(names);

  return (
    <>
      <AppBar title={title} icon={edit ? 'close' : 'back'} onIcon={onBack} live={edit ? null : voiceLive(voice, title)}>
        {!edit && <VoiceButtons voice={voice} />}
      </AppBar>
      <main className={edit ? 'screen players-edit' : 'screen'}>
        <h2 className="section-title">{t.players}</h2>
        <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div className="player-list">
        {names.map((name, i) => {
          const hints = open === i ? suggestNames(history, name) : [];
          return (
            <Row key={ids[i]} id={ids[i]!} sortable={edit} label={`${t.drag}: ${i + 1}`}>
              <input
                className={marked(voice, `name:${i}`, ['name-field', voice.listening && i === target && 'voice-target', dups.has(i) && 'name-dup'].filter(Boolean).join(' '))}
                aria-invalid={dups.has(i) || undefined}
                value={name}
                placeholder={t.enterName}
                aria-label={`${t.enterName} ${i + 1}`}
                onChange={(e) => {
                  setNames(setAt(names, i, e.target.value));
                  setOpen(i);
                }}
                onFocus={() => setOpen(i)}
                onBlur={() => setOpen(null)}
              />
              {edit ? (
                <Checkbox hideLabel label={`${t.inGame}: ${i + 1}`} checked={inGame[i] ?? true} onChange={(v) => setInGame(setAt(inGame, i, v))} />
              ) : (
                <>
                  <button
                    className={i === dealer ? 'circle circle-sm dealer-pick on' : 'circle circle-sm dealer-pick'}
                    aria-label={`${t.dealer}: ${i + 1}`}
                    aria-pressed={i === dealer}
                    onClick={() => setDealer(i)}
                  >
                    <Icon name="cards" size={18} />
                  </button>
                  <button
                    className="circle circle-sm"
                    aria-label={`${t.remove} ${i + 1}`}
                    onClick={() => {
                      setNames(names.filter((_, j) => j !== i));
                      setDealer(dealerAfterRemove(dealer, i));
                    }}
                  >
                    <Icon name="minus" size={18} />
                  </button>
                </>
              )}
              {hints.length > 0 && (
                <ul className="hints list-reset">
                  {hints.map((h) => (
                    <li key={h}>
                      <button
                        // mousedown + preventDefault: keep focus so blur doesn't close the list before the click
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setNames(setAt(names, i, h));
                          setOpen(null);
                        }}
                      >
                        {h}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Row>
          );
        })}
            </div>
          </SortableContext>
        </DndContext>
        <button className="btn btn-outline add-bar" aria-label={t.add} disabled={edit} onClick={() => setNames([...names, ''])}>
          <Icon name="plus" size={20} />
        </button>
        <Button disabled={!namesValid(names)} onClick={() => onSubmit(names, edit ? inGame : names.map(() => true), dealer, edit ? order : names.map((_, i) => i))}>
          {edit ? t.savePlayers : t.newGame}
        </Button>
      </main>
    </>
  );
}
