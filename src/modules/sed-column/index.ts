/** Geo-5: definición pura; la pista y el panel leen estas tablas del motor. */
import { defineModule, input, output, type TableCell } from '../../core/module';
import { param } from '../../core/params';
import { buildSedColumn, SED_COLUMN_DEFAULTS as D, SED_LITHOLOGY_LABELS, type SedColumnParams } from '../../petro/sedColumn';

export const SED_COLUMN_ID = 'sed-column';
export const SED_COLUMN_LAYERS = 'SED_COLUMN_LAYERS';
export const SED_COLUMN_SUMMARY = 'SED_COLUMN_SUMMARY';
export const engineParams = (p: SedColumnParams): SedColumnParams => ({ ...p });
export default defineModule({
  id: SED_COLUMN_ID, name: 'Columna sedimentológica', category: 'geology', workspace: 'geology',
  description: 'Litología y grano estimados desde perfiles, bloqueados en capas. Requiere calibración con testigo.',
  inputs: {
    gr: input.optionalCurve('GR'), vsh: input.optionalCurve('VSH'), quartz: input.optionalCurve('V_QUARTZ'), calcite: input.optionalCurve('V_CALCITE'),
    dolomite: input.optionalCurve('V_DOLOMITE'), clay: input.optionalCurve('V_CLAY'), phi: input.optionalCurve('PHI_MINERAL'), coal: input.optionalCurve('IND_COAL'), shale: input.optionalCurve('IND_SHALE'),
  },
  params: {
    // SIN VERIFICAR: los seis defaults y límites son decisiones operativas configurables.
    sedClayThreshold: param.number({ label: 'Umbral de arcilla', tooltip: 'Arcilla mineral o Vsh por encima de este valor se interpreta como lutita.', default: D.sedClayThreshold, min: .05, max: .95, step: .01, unit: 'v/v', group: 'Clasificación' }),
    sedSiltThreshold: param.number({ label: 'Inicio de limolita por Vsh', tooltip: 'Solo afecta rocas clásticas. Debe ser menor que el umbral de arcilla.', default: D.sedSiltThreshold, min: 0, max: .9, step: .01, unit: 'v/v', group: 'Clasificación' }),
    sedMinThickness: param.number({ label: 'Espesor mínimo de capa', tooltip: 'Preserva carbón y huecos. Un tramo aislado más fino se conserva y se señala.', default: D.sedMinThickness, min: 0, max: 5, step: .1, unit: 'm', group: 'Bloqueo' }),
    sedGrainScale: param.number({ label: 'Escala de grano estimado', tooltip: 'Ajusta el proxy de grano desde Vsh o GR; no representa textura de carbonatos ni descripción de testigo.', default: D.sedGrainScale, min: .2, max: 2, step: .05, group: 'Grano estimado' }),
    sedGrClean: param.number({ label: 'GR limpio del proxy', default: D.sedGrClean, min: 0, max: 150, step: 1, unit: 'gAPI', group: 'Fallback de GR' }),
    sedGrShale: param.number({ label: 'GR arcilloso del proxy', default: D.sedGrShale, min: 1, max: 300, step: 1, unit: 'gAPI', group: 'Fallback de GR' }),
  },
  outputs: {
    layers: output.table(SED_COLUMN_LAYERS, { label: 'Capas sedimentológicas', hidden: true, columns: [
      { key: 'top', label: 'Tope', unit: 'm' }, { key: 'base', label: 'Base', unit: 'm' }, { key: 'thickness', label: 'Espesor', unit: 'm' },
      { key: 'lithology', label: 'Litología', kind: 'text' }, { key: 'grain', label: 'Grano estimado', kind: 'text' }, { key: 'width', label: 'Ancho normalizado' },
      { key: 'zoneId', label: 'Id de zona', kind: 'text' }, { key: 'source', label: 'Fuente', kind: 'text' }, { key: 'belowMinimum', label: 'Bajo mínimo (1 = sí)' },
      ...['quartz', 'calcite', 'dolomite', 'clay', 'phi', 'vsh'].map(key => ({ key, label: key, unit: 'v/v' })),
    ] }),
    summary: output.table(SED_COLUMN_SUMMARY, { label: 'Espesor sedimentológico por zona', hidden: true, columns: [
      { key: 'zoneId', label: 'Id de zona', kind: 'text' }, { key: 'zone', label: 'Zona', kind: 'text' }, { key: 'lithology', label: 'Litología', kind: 'text' },
      { key: 'thickness', label: 'Espesor', unit: 'm' }, { key: 'percent', label: 'Proporción', unit: '%' }, { key: 'layerCount', label: 'Capas' },
    ] }),
  },
  compute({ depth, inputs, params, segments, zones, warn }) {
    const zoneIds: (string | null)[] = Array.from({ length: depth.length }, () => null);
    for (const s of segments) for (let i = s.start; i < s.end; i++) zoneIds[i] = s.zoneId;
    let layers;
    try { layers = buildSedColumn({ depth, ...inputs, zoneIds }, params); }
    catch (error) { warn(error instanceof Error ? error.message : 'Parámetros de columna inválidos.'); return { layers: { rows: [] }, summary: { rows: [] } }; }
    if (!layers.some(l => l.lithology !== 'unknown')) warn('Sin datos suficientes para clasificar la columna: cargá Vsh o GR, o la inversión mineral.');
    if (layers.some(l => l.belowMinimum && l.lithology !== 'coal' && l.lithology !== 'unknown')) warn('Hay tramos aislados bajo el mínimo entre carbón, huecos o límites de zona; se conservan sin inventar cobertura.');
    warn('Litología y grano estimados desde perfiles. El grano usa Vsh/GR y no describe textura de carbonatos; calibrá con testigo.');
    if (layers.some(l => l.source === 'minerals' || l.source === 'mixed')) warn('La clasificación hereda las limitaciones de la inversión mineral: revisá su residuo. No se infiere anhidrita con los componentes disponibles.');
    const rows: Record<string, TableCell>[] = layers.map(l => ({ ...l, belowMinimum: l.belowMinimum ? 1 : 0 }));
    const summary: Record<string, TableCell>[] = [];
    const groups = [ { id: null, name: 'Pozo completo' }, ...zones.map(z => ({ id: z.id, name: z.name })), ...(layers.some(l => l.zoneId === null) ? [{ id: '', name: 'Fuera de zona' }] : []) ];
    for (const g of groups) {
      const selected = layers.filter(l => g.id === null || l.zoneId === (g.id || null));
      const total = selected.reduce((sum, l) => sum + l.thickness, 0);
      for (const lithology of Object.keys(SED_LITHOLOGY_LABELS)) {
        const matching = selected.filter(l => l.lithology === lithology);
        const thickness = matching.reduce((sum, l) => sum + l.thickness, 0);
        summary.push({ zoneId: g.id, zone: g.name, lithology, thickness, percent: total ? 100 * thickness / total : 0, layerCount: matching.length });
      }
    }
    return { layers: { rows }, summary: { rows: summary } };
  },
  docs: {
    summary: 'Carbón por bandera; lutita por arcilla bulk mayor al corte; cuarzo, calcita o dolomita dominantes definen arenisca, caliza o dolomía. Vsh intermedio da limolita solo a la clase clástica. Sin volúmenes válidos, Vsh o GR normalizado define las clases clásticas. Bloqueo por moda móvil ponderada por espesor seguido de fusión de capas cortas, primero por litología y después por grano dentro de cada litología, preservando carbón, ausencia de datos, huecos y zonas. Los promedios de capa se ponderan por espesor válido. El proxy de grano interpola en tamaño logarítmico y usa las clases de Wentworth.',
    equations: [{ latex: 'I_{GR}=\\mathrm{clip}((GR-GR_{limpio})/(GR_{arcilloso}-GR_{limpio}),0,1)', description: 'Proxy usado solo si no hay Vsh válida.' }, { latex: '\\log_2 d_{mm}=-9+9(1-Vsh)s', description: 'Hipótesis operativa SIN VERIFICAR, con s configurable; no tamaño medido.' }],
    references: ['Wentworth, C. K. (1922). A scale of grade and class terms for clastic sediments. Journal of Geology 30(5), 377–392. DOI 10.1086/622910.', 'Rider y Kennedy (2011). The Geological Interpretation of Well Logs, 3.ª ed.: lectura de perfiles y limitaciones geológicas; no fuente de los cortes operativos.'],
    notes: 'Defaults, cortes, moda/fusión, proxy logarítmico y detección de huecos (>3 pasos medianos) SIN VERIFICAR. Gruesa agrupa arena gruesa y muy gruesa. Anhidrita queda preparada como clase, sin inferencia automática. Corona preparada en la firma, todavía no utilizada. Los carbonatos heredan el proxy de perfiles, no granulometría ni textura de Dunham. Cobertura de las muestras entre puntos medios y medio paso exterior; tramos aislados menores al mínimo se conservan y señalan.',
  },
});
