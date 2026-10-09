/** Indicador de actividad. Con `label` se anuncia (role="status"); sin él es decorativo. */
import './feedback.css';

export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <span
      className="ui-spinner"
      style={{ width: size, height: size, borderWidth: Math.max(1.5, size / 8) }}
      {...(label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true })}
    />
  );
}
