// Shared building blocks. Look follows docs/original-ux.md §1; styles in app.css.
import type { ReactNode } from 'react';
import { t } from './i18n';

// Material Icons paths (Apache 2.0), 24×24.
const ICONS = {
  menu: 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  star: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
};

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

export function Button({ children, onClick, disabled, small }: { children: ReactNode; onClick: () => void; disabled?: boolean; small?: boolean }) {
  return (
    <button className={small ? 'btn btn-small' : 'btn'} onClick={onClick} disabled={disabled}>
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
