/**
 * Histograma de la herramienta «Normalizar» (0060; Clase 8, slide 10): las muestras del intervalo de referencia antes
 * (gris) y después (color de la curva) con sus curvas de frecuencia acumulada. Los percentiles de origen son marcadores
 * arrastrables: el arrastre cambia solo el borrador (vista previa), Escape vuelve al nivel del comienzo del gesto y
 * las flechas lo mueven de a 0,5 (Mayús: 5). Las referencias (destino) se dibujan discontinuas con una flecha.
 */
import { useRef, useState } from 'react';
import { formatNumber, useUiScaleFactor } from '../../ui';
import { useCanvas } from '../../ui/canvas';
import { drawNormalizationHistogram, normalizationLayout, type NormalizationMarker } from './draw';
import { draggedPercentile, histogramFraction, histogramValueAt, nearestMarker, type HistogramModel, type MarkerId } from './normalizationView';

export interface HistogramMarkerLevel {
  id: MarkerId;
  /** Nivel de percentil (0–100). */
  level: number;
  /** Valor de origen de ese percentil. */
  value: number;
}

export function NormalizationHistogram({ model, sorted, color, unit, markers, references, hasAfter, onLevel, onGesture, height = 160 }: {
  model: HistogramModel;
  /** Muestra de origen ordenada (para pasar de valor a percentil). */
  sorted: Float64Array;
  color: string;
  unit: string;
  markers: readonly HistogramMarkerLevel[];
  references: readonly number[];
  hasAfter: boolean;
  onLevel(id: MarkerId, level: number): void;
  /** Comienzo y fin de un arrastre (el editor fija el eje mientras dura). */
  onGesture?(active: boolean): void;
  height?: number;
}) {
  const ui = useUiScaleFactor();
  const [active, setActive] = useState<MarkerId | null>(null);
  const [focusId, setFocusId] = useState<MarkerId>(markers[0]?.id ?? 'low');
  const gesture = useRef<{ id: MarkerId; start: number; pointer: number; cancelled: boolean } | null>(null);
  const label = (m: HistogramMarkerLevel) => `P${Number.isInteger(m.level) ? m.level : formatNumber(m.level, { digits: 1 })}`;
  const drawn: NormalizationMarker[] = markers.map((m) => ({ id: m.id, value: m.value, label: label(m) }));

  const ref = useCanvas(
    (ctx, size, t, scale) => drawNormalizationHistogram(ctx, size, t, scale, { model, color, unit, markers: drawn, references, active, hasAfter }),
    [model, color, unit, JSON.stringify(drawn), references.join(','), active, hasAfter],
  );

  const layout = () => {
    const el = ref.current;
    return normalizationLayout(el?.clientWidth ?? 0, el?.clientHeight ?? 0, ui);
  };
  const xOf = (clientX: number) => clientX - (ref.current?.getBoundingClientRect().left ?? 0);
  const valueAt = (clientX: number) => {
    const L = layout();
    return histogramValueAt(model, Math.min(1, Math.max(0, (xOf(clientX) - L.left) / L.width)));
  };
  const other = (id: MarkerId) => (id === 'low' ? (markers.find((m) => m.id === 'high')?.level ?? null) : id === 'high' ? (markers.find((m) => m.id === 'low')?.level ?? null) : null);
  const move = (id: MarkerId, value: number) => {
    const p = draggedPercentile(sorted, value, id, other(id));
    if (Number.isFinite(p)) onLevel(id, p);
  };

  const describe = markers.map((m) => `${label(m)} = ${formatNumber(m.value, { digits: 3 })} ${unit}`).join(', ');
  return (
    <div className="prep-norm-hist">
      <canvas
        ref={ref}
        className="prep-norm-hist__canvas"
        style={{ height }}
        tabIndex={0}
        role="slider"
        aria-label={`Histograma antes y después con frecuencia acumulada. Percentiles de origen: ${describe}. Flechas para mover ${focusId === 'high' ? 'el percentil alto' : focusId === 'low' ? 'el percentil bajo' : 'el percentil'}; Tab cambia de marcador.`}
        aria-valuenow={markers.find((m) => m.id === focusId)?.level ?? 0}
        aria-valuemin={0}
        aria-valuemax={100}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const L = layout();
          const id = nearestMarker(markers.map((m) => ({ id: m.id, x: L.left + histogramFraction(model, m.value) * L.width })), xOf(e.clientX), 12 * ui);
          if (!id) return;
          gesture.current = { id, start: markers.find((m) => m.id === id)!.level, pointer: e.pointerId, cancelled: false };
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.focus();
          setActive(id);
          setFocusId(id);
          onGesture?.(true);
          e.preventDefault();
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          const el = e.currentTarget;
          if (!g) {
            const L = layout();
            const near = nearestMarker(markers.map((m) => ({ id: m.id, x: L.left + histogramFraction(model, m.value) * L.width })), xOf(e.clientX), 12 * ui);
            el.style.cursor = near ? 'ew-resize' : 'default';
            return;
          }
          if (g.cancelled) return;
          move(g.id, valueAt(e.clientX));
        }}
        onPointerUp={(e) => {
          const g = gesture.current;
          gesture.current = null;
          setActive(null);
          if (!g) return;
          e.currentTarget.releasePointerCapture(g.pointer);
          onGesture?.(false);
        }}
        onPointerCancel={() => {
          if (gesture.current) onGesture?.(false);
          gesture.current = null;
          setActive(null);
        }}
        onKeyDown={(e) => {
          const g = gesture.current;
          if (e.key === 'Escape' && g && !g.cancelled) {
            e.preventDefault();
            e.stopPropagation();
            g.cancelled = true;
            onLevel(g.id, g.start);
            setActive(null);
            return;
          }
          if (e.key === 'Tab' && markers.length > 1 && !e.shiftKey === (focusId !== markers[markers.length - 1]!.id)) {
            e.preventDefault();
            const i = markers.findIndex((m) => m.id === focusId);
            setFocusId(markers[(i + 1) % markers.length]!.id);
            return;
          }
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const m = markers.find((x) => x.id === focusId) ?? markers[0];
          if (!m) return;
          const step = (e.shiftKey ? 5 : 0.5) * (e.key === 'ArrowLeft' ? -1 : 1);
          const o = other(m.id);
          let p = Math.round((m.level + step) * 10) / 10;
          if (m.id === 'low' && o !== null) p = Math.min(p, o - 1);
          if (m.id === 'high' && o !== null) p = Math.max(p, o + 1);
          onLevel(m.id, Math.min(100, Math.max(0, p)));
        }}
        onFocus={() => setActive(focusId)}
        onBlur={() => setActive(null)}
      />
      <ul className="prep-norm-hist__legend" aria-hidden="true">
        <li>
          <span className="prep-key__swatch prep-key__swatch--before" />
          Antes
        </li>
        {hasAfter && (
          <li>
            <span className="prep-key__swatch" style={{ background: color }} />
            Después (vista previa)
          </li>
        )}
        <li>
          <span className="prep-key__dash" />
          Acumulada antes
        </li>
        {hasAfter && (
          <li>
            <span className="prep-key__line" style={{ background: color }} />
            Acumulada después
          </li>
        )}
        <li>
          <span className="prep-key__ref" style={{ borderColor: color }} />
          Referencia
        </li>
      </ul>
    </div>
  );
}
