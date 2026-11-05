// Shared building blocks. Look follows docs/original-ux.md §1; styles in app.css.
import type { ReactNode } from 'react';
import { t } from './i18n';

// Material Icons paths (Apache 2.0), 24×24.
const ICONS = {
  menu: 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  drag: 'M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  star: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  // «style»: a fan of cards, marks the dealer
  cards:
    'm2.53 19.65 1.34.56v-9.03l-2.43 5.86c-.41 1.02.08 2.19 1.09 2.61zm19.5-3.7L17.07 3.98c-.31-.75-1.04-1.21-1.81-1.23-.26 0-.53.04-.79.15L7.1 5.95c-.75.31-1.21 1.03-1.23 1.8-.01.27.04.54.15.8l4.96 11.97c.31.76 1.05 1.22 1.83 1.23.26 0 .52-.05.77-.15l7.36-3.05c1.02-.42 1.51-1.59 1.09-2.6zM7.88 8.75c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-2 11c0 1.1.9 2 2 2h1.45l-3.45-8.34v6.34z',
};

/** Dealer mark next to a player's name. */
export const DealerMark = () => (
  <span className="dealer-mark" role="img" aria-label={t.dealer} title={t.dealer}>
    <Icon name="cards" size={20} />
  </span>
);

export const Icon = ({ name, size = 24 }: { name: keyof typeof ICONS; size?: number }) => (
  <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d={ICONS[name]} fill="currentColor" />
  </svg>
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
    <button className={['btn', small && 'btn-small', outline && 'btn-outline'].filter(Boolean).join(' ')} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** «-» value «+»; clamps to [min, max]. `label` names the group for screen readers and tests. */
export function Stepper(props: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; disabled?: boolean }) {
  const { label, value, onChange, min = 0, max = Infinity, step = 1, disabled } = props;
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button className="circle" disabled={disabled} onClick={() => set(value - step)}>
        -
      </button>
      <span className="stepper-value">{value}</span>
      <button className="circle" disabled={disabled} onClick={() => set(value + step)}>
        +
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
          <button onClick={onNo}>{t.no}</button>
          <button onClick={onYes}>{t.yes}</button>
        </div>
      </div>
    </div>
  );
}
