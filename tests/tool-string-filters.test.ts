/**
 * Sarta de perfilaje en los selectores y gráficos (fase 11c, docs/decisiones/0032 D9): histograma, crossplot (ejes,
 * color, plantillas), tendencias, lista de curvas y superposición de calidad usan el mismo filtro que el motor y el
 * visor. Lo oculto no aparece en ningún selector, nunca se borra un dato y al volver a prender todo vuelve como estaba.
 */
import { describe, expect, it } from 'vitest';
import { syntheticWell } from '../src/app/demo/syntheticWell';
import { hiddenCurvesOf, plotContextOf, visibleQc, visibleWell } from '../src/app/plots/context';
import { contextOf, seriesRegistry } from '../src/app/trends/providers';
import { emptyInterpretation, type Interpretation } from '../src/core/interpretation';
import { addWell, createProject, getWellEntry } from '../src/core/state/project';
import { setToolOn, setToolStringMode, showTool, startPlanning } from '../src/core/state/toolString';
import { hiddenByTool, hiddenCurveReason, hiddenCurves, showToolLabel, type ToolStringState } from '../src/core/toolString';
import { restrictQcReport, runQc } from '../src/io';
import { registry } from '../src/modules';
import { crossplotTemplatePatch } from '../src/plots/crossplot/applyTemplate';
import { hiddenCurveOfKey, hiddenCurveOfRole, keyForRole, plotCurveOptions, resolvePlotCurve } from '../src/plots/data';

const demo = syntheticWell(600);
const W = demo.well.id;
const state = (p: Partial<ToolStringState>): ToolStringState => ({ mode: 'data', off: [], order: [], plan: [], planOff: [], ...p });
const interp = (toolString?: ToolStringState): Interpretation => ({ ...emptyInterpretation(), zones: demo.zones, ...(toolString ? { toolString } : {}) });
const ctxOf = (toolString?: ToolStringState) => plotContextOf(demo.well, interp(toolString), []);
const keys = (toolString?: ToolStringState) => plotCurveOptions(ctxOf(toolString)).map((o) => o.value);
const DENSITY_OFF = state({ off: ['density'] });

describe('curvas ocultas por la sarta (núcleo, puro)', () => {
  it('sin tocar la sarta no hay nada oculto (mismo mapa vacío)', () => {
    expect(hiddenCurves(demo.well.curves, undefined, registry.tools).size).toBe(0);
    expect(hiddenCurves(demo.well.curves, state({}), registry.tools)).toBe(hiddenCurves(demo.well.curves, undefined, registry.tools));
  });

  it('densidad apagada: ZDEN (RHOB) y PE (PEF) ocultas, con la herramienta y el motivo', () => {
    const h = hiddenCurves(demo.well.curves, DENSITY_OFF, registry.tools);
    expect([...h.keys()].sort()).toEqual(['PE', 'ZDEN']);
    expect(h.get('ZDEN')).toMatchObject({ mnemonic: 'ZDEN', role: 'RHOB', toolId: 'density', reason: 'off' });
    expect(hiddenCurveReason(h.get('ZDEN')!)).toBe(`La herramienta ${h.get('ZDEN')!.toolName} está apagada en la sarta.`);
    expect(showToolLabel(h.get('ZDEN')!)).toBe(`Prender ${h.get('ZDEN')!.toolName}`);
    expect(hiddenByTool(h)).toEqual([{ toolId: 'density', toolName: h.get('ZDEN')!.toolName, reason: 'off', mnemonics: ['ZDEN', 'PE'] }]);
  });

  it('planificación: lo que no está en el plan queda «fuera de la sarta planificada»; lo apagado en el plan, «apagado»', () => {
    const h = hiddenCurves(demo.well.curves, state({ mode: 'planning', plan: ['gr', 'density'], planOff: ['density'] }), registry.tools);
    expect(h.get('ZDEN')?.reason).toBe('off');
    expect(h.get('NPHI')?.reason).toBe('outside-plan');
    expect(h.has('GR')).toBe(false);
    expect(h.has('BS')).toBe(false); // sin herramienta: nunca se oculta
    expect(showToolLabel(h.get('NPHI')!)).toMatch(/^Agregar .* a la sarta$/);
  });
});

describe('selectores del histograma y del crossplot', () => {
  it('con Densidad apagada, ZDEN y PE no están en las opciones; el resto sí', () => {
    const all = keys();
    expect(all).toEqual(expect.arrayContaining(['m:ZDEN', 'm:PE', 'm:NPHI', 'm:GR']));
    const off = keys(DENSITY_OFF);
    expect(off).not.toContain('m:ZDEN');
    expect(off).not.toContain('m:PE');
    expect(off).toEqual(all.filter((k) => k !== 'm:ZDEN' && k !== 'm:PE'));
  });

  it('una curva elegida que la sarta oculta no se resuelve, pero se sabe por qué (estado vacío, no error)', () => {
    const ctx = ctxOf(DENSITY_OFF);
    expect(resolvePlotCurve(ctx, 'm:ZDEN')).toBeNull();
    expect(hiddenCurveOfKey(ctx, 'm:ZDEN')).toMatchObject({ toolId: 'density', reason: 'off' });
    expect(hiddenCurveOfKey(ctx, 'm:GR')).toBeNull();
    expect(hiddenCurveOfKey(ctx, 'r:RHOB')).toBeNull();
    expect(hiddenCurveOfKey(ctxOf(), 'm:ZDEN')).toBeNull();
    // El eje por defecto (RHOB) ya no es la medida oculta.
    expect(keyForRole(ctx, 'RHOB')).not.toBe('m:ZDEN');
    expect(hiddenCurveOfRole(ctx, 'RHOB')?.mnemonic).toBe('ZDEN');
  });

  it('al volver a prender, la misma clave vuelve a resolverse con los mismos datos (nada se borró)', () => {
    let p = addWell(createProject('Filtros'), demo.well, demo.zones);
    p = setToolOn(p, W, 'density', false);
    const offCtx = plotContextOf(demo.well, getWellEntry(p, W).interpretation, []);
    expect(resolvePlotCurve(offCtx, 'm:ZDEN')).toBeNull();
    p = setToolOn(p, W, 'density', true);
    const onCtx = plotContextOf(demo.well, getWellEntry(p, W).interpretation, []);
    expect(resolvePlotCurve(onCtx, 'm:ZDEN')?.data).toBe(resolvePlotCurve(ctxOf(), 'm:ZDEN')?.data);
    expect(onCtx.hidden).toBeUndefined();
  });

  it('plantilla densidad–neutrón con Densidad apagada: no se arma y dice qué herramienta prender', () => {
    const r = crossplotTemplatePatch(ctxOf(DENSITY_OFF), 'density-neutron');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.hidden?.toolId).toBe('density');
    expect(r.description).toContain('está oculta');
    expect(r.description).toContain(r.hidden!.toolName);
    expect(crossplotTemplatePatch(ctxOf(), 'density-neutron').ok).toBe(true);
  });

  it('las tendencias tampoco ofrecen curvas ocultas', () => {
    const list = (t?: ToolStringState) => seriesRegistry.list(contextOf({ well: demo.well, interpretation: interp(t), computed: [] })).map((o) => o.key);
    expect(list()).toContain('m:ZDEN');
    expect(list(DENSITY_OFF)).not.toContain('m:ZDEN');
  });
});

describe('pozo según la sarta (identidad estable)', () => {
  it('sin nada oculto devuelve el mismo pozo; con la misma sarta, el mismo pozo derivado', () => {
    expect(visibleWell(demo.well, interp())).toBe(demo.well);
    const i = interp(DENSITY_OFF);
    const a = visibleWell(demo.well, i);
    expect(a).not.toBe(demo.well);
    expect(a.curves.map((c) => c.id)).not.toContain('ZDEN');
    expect(visibleWell(demo.well, i)).toBe(a);
    expect(hiddenCurvesOf(demo.well, i)).toBe(hiddenCurvesOf(demo.well, i));
    // El pozo del proyecto no se toca.
    expect(demo.well.curves.map((c) => c.id)).toContain('ZDEN');
  });
});

describe('atajo «Prender …» de los estados vacíos (receta showTool)', () => {
  it('en datos prende la herramienta; en planificación la agrega al plan (o la prende ahí)', () => {
    let p = addWell(createProject('Atajo'), demo.well, demo.zones);
    p = setToolOn(p, W, 'density', false);
    expect(getWellEntry(showTool(p, W, 'density'), W).interpretation.toolString).toBeUndefined();
    let q = startPlanning(p, W, 'empty', registry.tools);
    q = showTool(q, W, 'neutron');
    expect(getWellEntry(q, W).interpretation.toolString?.plan).toEqual(['neutron']);
    // Planificar no toca los datos: al volver, Densidad sigue apagada.
    q = setToolStringMode(q, W, 'data');
    expect(getWellEntry(q, W).interpretation.toolString?.off).toEqual(['density']);
  });
});

describe('superposición de calidad según la sarta', () => {
  const report = runQc(demo.well, { roles: registry.roles });

  it('sin nada oculto, el mismo reporte', () => {
    expect(restrictQcReport(report, new Set())).toBe(report);
    expect(visibleQc(report, demo.well, interp())).toBe(report);
  });

  it('densidad oculta: sale de las curvas y de las afectadas por derrumbes; el caliper sigue', () => {
    expect(report.borehole?.affectedCurveIds).toEqual(expect.arrayContaining(['ZDEN', 'PE']));
    const r = visibleQc(report, demo.well, interp(DENSITY_OFF))!;
    expect(r.curves.map((c) => c.curveId)).not.toContain('ZDEN');
    expect(r.borehole?.affectedCurveIds).not.toContain('ZDEN');
    expect(r.borehole?.washouts).toBe(report.borehole?.washouts);
    expect(visibleQc(report, demo.well, interp(DENSITY_OFF))).toBe(r);
  });

  it('caliper oculto: sin evaluación de derrumbes (sale del caliper); el reporte original no cambia', () => {
    const r = restrictQcReport(report, new Set(['CAL']));
    expect(r.borehole).toBeNull();
    expect(report.borehole).not.toBeNull();
    expect(r.curves).toHaveLength(report.curves.length - 1);
  });
});
