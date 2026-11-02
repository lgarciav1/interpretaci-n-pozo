/**
 * Vista previa de las curvas digitalizadas como pistas (profundidad hacia abajo, una pista por curva, con la escala
 * marcada: lineal o log, normal o invertida). Si el pozo activo tiene una curva del mismo rol en ese tramo, se dibuja
 * debajo en gris para comparar.
 */
import { fractionToValue, valueToFraction, type AxisScale } from '../../../viewer/scale';
import type { DigitizedSeries } from '../../../digitizer';
import type { Well } from '../../../core/well';
import { BASE_TOKENS, canvasFont, curveStyle } from '../../../ui';
import { useCanvas } from '../../../ui/canvas';
import { formatNumber } from '../../../ui/format';
import { registry } from '../../index';
import { frameOf, inkColor, type CurveDraft } from '../model/form';

export interface PreviewItem {
  curve: CurveDraft;
  series: DigitizedSeries;
}

export function PreviewTracks({ items, well, height = 420 }: { items: readonly PreviewItem[]; well: Well | null; height?: number }) {
  const ref = useCanvas(
    (ctx, { width, height: h }, t, ui) => {
      const withData = items.filter((i) => i.series.depthM.length > 1);
      if (!withData.length) return;
      let top = Infinity;
      let base = -Infinity;
      for (const { series } of withData) {
        top = Math.min(top, series.depthM[0]!);
        base = Math.max(base, series.depthM[series.depthM.length - 1]!);
      }
      const axisW = 46 * ui;
      const headH = 30 * ui;
      const gap = 6 * ui;
      const n = withData.length;
      const tw = (width - axisW - gap * n) / n;
      const yOf = (d: number) => headH + ((d - top) / (base - top || 1)) * (h - headH - 6 * ui);
      ctx.font = canvasFont(BASE_TOKENS.text.xs, 500, ui);
      // Eje de profundidad.
      const span = base - top;
      const raw = span / 8;
      const p = 10 ** Math.floor(Math.log10(raw || 1));
      const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
      ctx.fillStyle = t.viewer.axisText;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let d = Math.ceil(top / step) * step; d <= base; d += step) {
        const y = yOf(d);
        ctx.fillText(formatNumber(d, { digits: step < 1 ? 1 : 0 }), axisW - 6 * ui, y);
        ctx.strokeStyle = t.viewer.gridMinor;
        ctx.beginPath();
        ctx.moveTo(axisW, Math.round(y) + 0.5);
        ctx.lineTo(width, Math.round(y) + 0.5);
        ctx.stroke();
      }
      withData.forEach(({ curve, series }, k) => {
        const x0 = axisW + gap / 2 + k * (tw + gap);
        const frame = frameOf(curve).frame;
        const scale: AxisScale = frame?.scale ?? series.scale;
        const style = curveStyle(curve.role, t.name, registry.roles, curve.mnemonic);
        const color = curve.role ? style.color : inkColor(curve) ?? t.color.text;
        ctx.fillStyle = t.viewer.trackBg;
        ctx.fillRect(x0, headH, tw, h - headH - 6 * ui);
        ctx.strokeStyle = t.viewer.trackBorder;
        ctx.strokeRect(x0 + 0.5, headH + 0.5, tw - 1, h - headH - 6 * ui - 1);
        const xOf = (v: number) => x0 + valueToFraction(v, scale) * tw;
        // Comparación con el pozo activo (misma rol, tramo común).
        const ref = well && curve.role ? well.curves.find((c) => c.role === curve.role && c.origin.kind === 'measured' && c.origin.source !== 'Log Digitizer') : null;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, headH, tw, h - headH);
        ctx.clip();
        if (ref && well) {
          ctx.strokeStyle = t.color.textSubtle;
          ctx.lineWidth = 1;
          ctx.beginPath();
          let pen = false;
          const dv = well.depth.values;
          for (let i = 0; i < dv.length; i++) {
            const d = dv[i]!;
            const v = ref.data[i]!;
            if (d < top || d > base || !Number.isFinite(v) || (scale.kind === 'log' && v <= 0)) {
              pen = false;
              continue;
            }
            const x = xOf(v);
            const y = yOf(d);
            if (pen) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
            pen = true;
          }
          ctx.stroke();
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let prev = NaN;
        for (let i = 0; i < series.depthM.length; i++) {
          const d = series.depthM[i]!;
          const x = xOf(series.values[i]!);
          const y = yOf(d);
          if (i > 0 && d - prev < (base - top) / 200 + 1) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
          prev = d;
        }
        ctx.stroke();
        ctx.restore();
        // Encabezado: nombre y rango.
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.font = canvasFont(BASE_TOKENS.text.xs, 600, ui);
        ctx.fillText(curve.mnemonic + (ref ? ` · ${ref.mnemonic} en gris` : ''), x0 + tw / 2, 2 * ui, tw);
        ctx.font = canvasFont(BASE_TOKENS.text.xs, 400, ui);
        ctx.fillStyle = t.viewer.axisText;
        ctx.textAlign = 'left';
        ctx.fillText(formatNumber(fractionToValue(0, scale), { significant: 3 }), x0 + 2, 15 * ui);
        ctx.textAlign = 'right';
        ctx.fillText(formatNumber(fractionToValue(1, scale), { significant: 3 }), x0 + tw - 2, 15 * ui);
      });
    },
    [items, well],
  );
  return <canvas ref={ref} className="dz-preview" style={{ height: `calc(${height}px * var(--ui-scale))` }} role="img" aria-label="Vista previa de las curvas digitalizadas en pistas" />;
}
