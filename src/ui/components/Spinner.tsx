/** Indicador de actividad. Con `label` se anuncia (role="status"); sin él es decorativo. */
import './feedback.css';

/** `size`: px en el nivel Compacto; escala con el tamaño de interfaz. */
export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <span
      className="ui-spinner"
      style={{ width: `calc(${size}px * var(--ui-scale, 1))`, height: `calc(${size}px * var(--ui-scale, 1))`, borderWidth: Math.max(1.5, size / 8) }}
      {...(label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true })}
    />
  );
}
