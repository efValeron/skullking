// Shared building blocks; styles in app.css.
import type { ReactNode } from 'react';
import { ArrowLeft, Check, GripVertical, Menu, Mic, Minus, PlayingCardsFan, Plus, Star, X, type LucideIcon } from 'lucide-react';
import { t } from './i18n';

// One icon set (Lucide, ISC): rounded strokes that match the rounded type and card stock.
const ICONS = { menu: Menu, back: ArrowLeft, close: X, drag: GripVertical, star: Star, check: Check, cards: PlayingCardsFan, minus: Minus, plus: Plus, mic: Mic } satisfies Record<string, LucideIcon>;

export const Icon = ({ name, size = 24 }: { name: keyof typeof ICONS; size?: number }) => {
  const Svg = ICONS[name];
  return <Svg className="icon" size={size} strokeWidth={2} aria-hidden="true" />;
};

/** Dealer mark next to a player's name. */
export const DealerMark = () => (
  <span className="dealer-mark" role="img" aria-label={t.dealer} title={t.dealer}>
    <Icon name="cards" size={18} />
  </span>
);

export function AppBar({ title, icon, onIcon }: { title: string; icon?: 'menu' | 'back' | 'close'; onIcon?: () => void }) {
  const label = icon === 'menu' ? t.menuOpen : icon === 'back' ? t.back : t.close;
  return (
    <header className={icon ? 'appbar' : 'appbar appbar-plain'}>
      {icon && (
        <button className="appbar-icon" aria-label={label} onClick={onIcon}>
          <Icon name={icon} />
        </button>
      )}
      <h1>{title}</h1>
    </header>
  );
}

export function Button(props: { children: ReactNode; onClick: () => void; disabled?: boolean; small?: boolean; /** secondary action: outline only */ outline?: boolean }) {
  const { children, onClick, disabled, small, outline } = props;
  return (
    <button className={['btn', outline ? 'btn-outline' : 'btn-primary', small && 'btn-small'].filter(Boolean).join(' ')} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** − value +; clamps to [min, max]. `label` names the group for screen readers and tests. */
export function Stepper(props: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; disabled?: boolean }) {
  const { label, value, onChange, min = 0, max = Infinity, step = 1, disabled } = props;
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button className="circle" aria-label={t.decrease} disabled={disabled} onClick={() => set(value - step)}>
        <Icon name="minus" size={18} />
      </button>
      <span className="stepper-value">{value}</span>
      <button className="circle" aria-label={t.increase} disabled={disabled} onClick={() => set(value + step)}>
        <Icon name="plus" size={18} />
      </button>
    </div>
  );
}

export function Checkbox({ label, checked, onChange, disabled, hideLabel }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hideLabel?: boolean }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={hideLabel ? label : undefined} />
      <span className="checkbox-box" aria-hidden="true">
        {checked && <Icon name="check" size={16} />}
      </span>
      {!hideLabel && <span>{label}</span>}
    </label>
  );
}

/** Light paper card (summary, card-limit warning, edit hint). */
export const Card = ({ children }: { children: ReactNode }) => <div className="card">{children}</div>;

/** Modal bottom sheet; tap on the scrim closes it. */
export function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, text, onNo, onYes }: { title: string; text: string; onNo: () => void; onYes: () => void }) {
  return (
    <div className="scrim scrim-center">
      <div className="dialog" role="alertdialog" aria-label={title}>
        <h2>{title}</h2>
        <p>{text}</p>
        <div className="dialog-actions">
          <Button small outline onClick={onNo}>
            {t.no}
          </Button>
          <Button small onClick={onYes}>
            {t.yes}
          </Button>
        </div>
      </div>
    </div>
  );
}
