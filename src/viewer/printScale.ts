/**
 * Escalas de impresión del selector de la barra del visor (docs/decisiones/0067, D11). Puro.
 *
 * La escala 1:N es la de la pantalla a 96 ppp (la misma cuenta que `scaleRatio` y que las figuras exportadas): a
 * 1:200, un metro de pozo mide 5 mm en pantalla con el zoom del navegador al 100 %. La equivalencia en «cm cada 100 m»
 * es la del papel: 10 000 / N.
 */
import { pxPerMeterForScale, scaleDenominatorFor } from '../io/export/figures/sizing';
import { formatNumber } from '../ui/format';
import type { ViewportLimits } from './viewport';

/** Escalas que ofrece el selector (las de los perfiles impresos). */
export const PRINT_SCALES = [200, 500, 1000, 2000, 5000] as const;

/** Centímetros de papel por cada 100 m de pozo a 1:N. */
export const cmPer100m = (denominator: number): number => 10000 / denominator;

export interface PrintScaleOption {
  denominator: number;
  /** «1:200». */
  label: string;
  /** «50 cm cada 100 m». */
  detail: string;
  pxPerM: number;
  /** El pozo o el zoom máximo no la permiten (y por qué). */
  disabled: string | null;
}

const fmtScale = (n: number) => `1:${formatNumber(n, { digits: 0 })}`;

/**
 * Opciones del selector para estos límites. Una escala más alejada que «ver todo» (el pozo entero entra con margen)
 * o más cercana que el zoom máximo (32 px por muestra) queda deshabilitada con el motivo.
 */
export function printScaleOptions(lim: Pick<ViewportLimits, 'minPxPerM' | 'maxPxPerM'>): PrintScaleOption[] {
  return PRINT_SCALES.map((n) => {
    const pxPerM = pxPerMeterForScale(n);
    const cm = cmPer100m(n);
    const disabled = pxPerM < lim.minPxPerM * 0.999 ? 'El pozo entero entra en la ventana a una escala más cercana' : pxPerM > lim.maxPxPerM * 1.001 ? 'Más cerca que el zoom máximo del pozo' : null;
    return { denominator: n, label: fmtScale(n), detail: `${formatNumber(cm, { digits: Number.isInteger(cm) ? 0 : 1 })} cm cada 100 m`, pxPerM, disabled };
  });
}

/** Escala de impresión que coincide con el zoom actual (±2 %), o null. Marca la opción elegida en el selector. */
export function matchingPrintScale(pxPerM: number): number | null {
  const n = scaleDenominatorFor(pxPerM);
  return PRINT_SCALES.find((s) => Math.abs(n / s - 1) <= 0.02) ?? null;
}

/** Rótulo del botón del selector: la escala actual redondeada a 2 cifras («1:9.600»), o la de impresión exacta. */
export function scaleButtonLabel(pxPerM: number): string {
  const exact = matchingPrintScale(pxPerM);
  return fmtScale(exact ?? +scaleDenominatorFor(pxPerM).toPrecision(2));
}
