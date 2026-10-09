/**
 * Avisos efímeros: `toast('Proyecto guardado')` o `toast({ title, description, tone })` desde cualquier lugar.
 * `<Toaster />` (una vez, en la raíz) los muestra en una región `aria-live`.
 */
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import './overlay.css';
import { IconButton } from './Button';
import type { Tone } from './Feedback';
import { Icon, type IconName } from './Icon';
import { Portal } from './layer';

export interface ToastInput {
  title: ReactNode;
  description?: ReactNode;
  tone?: Tone;
  /** ms; 0 = no se cierra solo. Por defecto 4000 (errores: 8000). */
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getItems = () => items;

export function toast(input: ToastInput | string): number {
  const t: ToastItem = { id: nextId++, ...(typeof input === 'string' ? { title: input } : input) };
  items = [...items, t].slice(-4);
  emit();
  return t.id;
}

export function dismissToast(id: number): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

const ICON: Record<Tone, IconName> = { neutral: 'info', accent: 'info', info: 'info', ok: 'check-circle', warn: 'warning', error: 'error' };

function ToastView({ item }: { item: ToastItem }) {
  const tone = item.tone ?? 'neutral';
  useEffect(() => {
    const ms = item.duration ?? (tone === 'error' ? 8000 : 4000);
    if (ms <= 0) return;
    const t = setTimeout(() => dismissToast(item.id), ms);
    return () => clearTimeout(t);
  }, [item, tone]);
  return (
    <div className={`ui-toast ui-toast--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={ICON[tone]} size={16} className="ui-toast__icon" />
      <div className="ui-toast__body">
        <div className="ui-toast__title">{item.title}</div>
        {item.description && <div className="ui-toast__desc">{item.description}</div>}
      </div>
      <IconButton icon="x" label="Cerrar aviso" size="sm" onClick={() => dismissToast(item.id)} tooltip={false} />
    </div>
  );
}

export function Toaster() {
  const list = useSyncExternalStore(subscribe, getItems, getItems);
  return (
    <Portal>
      <div className="ui-toaster" aria-live="polite">
        {list.map((t) => (
          <ToastView key={t.id} item={t} />
        ))}
      </div>
    </Portal>
  );
}
