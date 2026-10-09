/**
 * Zona para soltar o elegir un archivo: arrastrar y soltar, clic o teclado (Enter/Espacio) abren el selector.
 * La usan el asistente de carga de pozos y, más adelante, la carga de datos de corona.
 */
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import './filedrop.css';
import { Icon, type IconName } from './Icon';

export interface FileDropProps {
  onFile(file: File): void;
  /** Extensiones aceptadas por el selector (`.xlsx,.las`). */
  accept?: string;
  title: ReactNode;
  description?: ReactNode;
  icon?: IconName;
  disabled?: boolean;
  /** data-testid del input de archivo oculto (para pruebas automáticas). */
  inputTestId?: string;
}

export function FileDrop({ onFile, accept, title, description, icon = 'upload', disabled = false, inputTestId }: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const open = () => !disabled && inputRef.current?.click();
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file && !disabled) onFile(file);
  };
  return (
    <>
      <div
        className={`ui-filedrop${over ? ' is-over' : ''}${disabled ? ' is-disabled' : ''}`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <span className="ui-filedrop__icon" aria-hidden="true">
          <Icon name={icon} size={22} />
        </span>
        <span className="ui-filedrop__title">{title}</span>
        {description && <span className="ui-filedrop__text">{description}</span>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        data-testid={inputTestId}
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (f) onFile(f);
        }}
      />
    </>
  );
}
