/**
 * Proveedor de series `crossplot` (tendencias sobre la nube del crossplot libre; docs/decisiones/0014). La lógica es
 * pura y vive en `src/plots/crossplot/series.ts`; acá solo se registra (la app descubre `seriesProviders`).
 */
import { crossplotSeriesProvider } from '../../plots/crossplot/series';
import type { TrendSeriesProvider } from '../../plots/trend/series';

export const seriesProviders: TrendSeriesProvider[] = [crossplotSeriesProvider];
