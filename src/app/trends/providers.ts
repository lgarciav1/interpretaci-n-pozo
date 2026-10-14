/**
 * Proveedores de series para tendencias: el incorporado (curvas del visor) + los de los módulos
 * (`src/modules/<id>/series.ts` que exporte `seriesProviders: TrendSeriesProvider[]`), descubiertos solos como los
 * paneles y las superposiciones. El worker del motor nunca importa estos archivos.
 */
import type { SeriesRef } from '../../core/trends';
import { plotContextOf } from '../plots/context';
import { createSeriesRegistry, curveSeriesProvider, type ResolvedSeries, type SeriesContext, type TrendSeriesProvider } from '../../plots/trend/series';
import type { ViewerData } from '../../viewer/overlay';

const found = import.meta.glob<{ seriesProviders?: TrendSeriesProvider[] }>('../../modules/*/series.ts', { eager: true });

function moduleProviders(): TrendSeriesProvider[] {
  const out: TrendSeriesProvider[] = [];
  for (const [path, mod] of Object.entries(found)) {
    if (!Array.isArray(mod.seriesProviders)) {
      console.warn(`${path} no exporta 'seriesProviders' (TrendSeriesProvider[]); se ignora.`);
      continue;
    }
    out.push(...mod.seriesProviders);
  }
  return out;
}

export const seriesRegistry = createSeriesRegistry([curveSeriesProvider, ...moduleProviders()]);

/**
 * Contexto de los proveedores a partir de los datos del visor (pozo, interpretación y calculadas activos), con el pozo
 * según la sarta (0032): una tendencia sobre una curva de una herramienta apagada queda «sin datos» hasta prenderla.
 */
export function contextOf(data: Pick<ViewerData, 'well' | 'interpretation' | 'computed'>): SeriesContext {
  return plotContextOf(data.well, data.interpretation, data.computed);
}

export function resolveSeries(data: Pick<ViewerData, 'well' | 'interpretation' | 'computed'>, ref: SeriesRef): ResolvedSeries | null {
  return seriesRegistry.resolve(contextOf(data), ref);
}
