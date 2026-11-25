/**
 * Plantillas de determinación de litologías (Clase 8; docs/decisiones/0059): registro, ejes, deshabilitadas sin sus
 * curvas, líneas guía contra la hoja CROSSPLOT del Excel de la cátedra y el módulo `lithology-indices` sobre el TP.
 */
import { describe, expect, it } from 'vitest';
import csvText from '../../datos/pozo_tp_perfiles.csv?raw';
import fixture from '../fixtures/catedra-crossplot-overlays.json';
import { Engine, toEngineWell } from '../../src/core/engine/engine';
import { emptyInterpretation } from '../../src/core/interpretation';
import { CROSSPLOT_TEMPLATES, sanitizeCrossplot } from '../../src/core/plots';
import { defaultRoleCatalog } from '../../src/core/roles';
import { createWell } from '../../src/core/well';
import { readWellFile } from '../../src/io';
import { registry } from '../../src/modules';
import { LITH1_BOXES, MID_CHART_RANGE, MID_VERTICES, UMAA_TRIANGLE, boxVertices } from '../../src/petro/lithologyIndices';
import lithologyIndicesModule from '../../src/modules/lithology-indices';
import { crossplotTemplatePatch } from '../../src/plots/crossplot/applyTemplate';
import { CROSSPLOT_TEMPLATE_DEFS, LITHOLOGY_TEMPLATE_IDS, arrowPath, lithologyTemplateLayers, templateDef } from '../../src/plots/crossplot/templates';
import type { SeriesContext } from '../../src/plots/trend/series';

type Cell = [string, string | number];
const cells = new Map((fixture.celdas as Cell[]).map(([ref, v]) => [ref, v]));
const num = (ref: string) => cells.get(ref) as number | undefined;

// ── registro y ejes ───────────────────────────────────────────────────────────────────────────────────────────

describe('las siete plantillas de litología', () => {
  it('están en el tipo del núcleo, en las definiciones y sobreviven al saneamiento', () => {
    for (const id of LITHOLOGY_TEMPLATE_IDS) {
      expect(CROSSPLOT_TEMPLATES).toContain(id);
      expect(templateDef(id)?.group).toBe('lithology');
      expect(sanitizeCrossplot({ template: id }).template).toBe(id);
    }
    // 13 + Thomas–Stieber (0061) + MID (G04).
    expect(CROSSPLOT_TEMPLATE_DEFS).toHaveLength(15);
  });

  it('ejes por rol, Th/K en log, PEF–K lineal y MID en DTMAA–RHOMAA (invertido)', () => {
    const axes = (id: (typeof LITHOLOGY_TEMPLATE_IDS)[number]) => { const d = templateDef(id)!; return [d.x.role, d.x.scale, d.y.role, d.y.scale, !!d.y.reversed]; };
    expect(axes('sonic-neutron')).toEqual(['NPHI', 'linear', 'DT', 'linear', false]);
    expect(axes('density-sonic')).toEqual(['DT', 'linear', 'RHOB', 'linear', true]);
    expect(axes('m-n')).toEqual(['N', 'linear', 'M', 'linear', false]);
    expect(axes('rhomaa-umaa')).toEqual(['UMAA', 'linear', 'RHOMAA', 'linear', true]);
    expect(axes('mid')).toEqual(['DTMAA', 'linear', 'RHOMAA', 'linear', true]);
    expect(axes('pe-k')).toEqual(['POTA', 'linear', 'PEF', 'linear', false]);
    expect(axes('pe-thk')).toEqual(['THK', 'log', 'PEF', 'linear', false]);
    expect(templateDef('pe-thk')!.x.range).toEqual([0.1, 100]);
    expect(templateDef('mid')!.x.range).toEqual(MID_CHART_RANGE.dt);
    expect(templateDef('mid')!.y.range).toEqual(MID_CHART_RANGE.rho);
    expect(templateDef('mid')!.label).toBe('Identificación de matriz sin PE (MID: ρmaa–Δtmaa)');
    expect(templateDef('mid')!.shortLabel).toBe('MID: ρmaa–Δtmaa (sin PE)');
  });

  it('cada plantilla trae líneas o cajas, todas finitas, y un texto de ayuda', () => {
    for (const id of LITHOLOGY_TEMPLATE_IDS) {
      const l = lithologyTemplateLayers(id);
      expect(l.lines.length + l.polygons.length, id).toBeGreaterThan(0);
      expect(l.info.length, id).toBeGreaterThan(40);
      for (const line of l.lines) for (const v of [...Array.from(line.x), ...Array.from(line.y)]) expect(Number.isFinite(v), `${id} ${line.id}`).toBe(true);
      // Ninguna ecuación en la interfaz (0059: solo en el módulo Ecuaciones).
      expect(l.info).not.toMatch(/[=√]/);
    }
  });
});

// ── deshabilitadas sin sus curvas ─────────────────────────────────────────────────────────────────────────────

const n = 12;
const series = (v: number) => Float64Array.from({ length: n }, () => v);
const emptyWell = createWell({ id: 'w', name: 'W', depth: Float64Array.from({ length: n }, (_, i) => 1000 + i), curves: [] });
const ctxOf = (computed: SeriesContext['computed'] = []): SeriesContext => ({ well: emptyWell, interpretation: { ...emptyInterpretation([]) }, computed, catalog: registry.roles });

describe('sin sus curvas quedan deshabilitadas con el motivo', () => {
  it.each(LITHOLOGY_TEMPLATE_IDS.map((id) => [id]))('%s', (id) => {
    const r = crossplotTemplatePatch(ctxOf(), id);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.title).toContain(templateDef(id)!.label);
    expect(r.reason).toMatch(/^falta /);
    if (templateDef(id)!.needs) expect(r.description).toContain('Índices de litología');
  });

  it('una curva derivada que existe pero quedó sin dato también la deshabilita', () => {
    const r = crossplotTemplatePatch(ctxOf([
      { port: 'THK', moduleId: 'lithology-indices', label: 'Th/K', data: series(NaN), active: true },
      { port: 'PEF', moduleId: 'x', label: 'PEF', data: series(3), active: true },
    ]), 'pe-thk');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('THK sin datos');
  });

  it('con sus curvas se arma, colorea por zona las de minerales y respeta la escala log', () => {
    const r = crossplotTemplatePatch(ctxOf([
      { port: 'THK', moduleId: 'lithology-indices', label: 'Th/K', data: series(4), active: true },
      { port: 'PEF', moduleId: 'x', label: 'PEF', data: series(3), active: true },
    ]), 'pe-thk');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch).toMatchObject({ xScale: 'log', yScale: 'linear', xRange: [0.1, 100], yRange: [0, 10], template: 'pe-thk', color: { kind: 'zone' } });
  });
});

// ── contra la hoja CROSSPLOT de la cátedra ────────────────────────────────────────────────────────────────────

/** Recta entre dos vértices del triángulo evaluada en un Umaa dado. */
function edgeAt(a: (typeof UMAA_TRIANGLE)[number], b: (typeof UMAA_TRIANGLE)[number], u: number): number {
  return a.rho + ((u - a.u) * (b.rho - a.rho)) / (b.u - a.u);
}

describe('ρmaa–Umaa contra el Excel de la cátedra (columnas D:I)', () => {
  const [Q, C, D] = UMAA_TRIANGLE as unknown as [(typeof UMAA_TRIANGLE)[number], (typeof UMAA_TRIANGLE)[number], (typeof UMAA_TRIANGLE)[number]];
  const pairs = (xCol: string, yCol: string) => {
    const out: [number, number][] = [];
    for (let row = 62; row <= 78; row++) {
      const x = num(`${xCol}${row}`);
      const y = num(`${yCol}${row}`);
      if (x !== undefined && y !== undefined) out.push([x, y]);
    }
    return out;
  };

  it('arena → calcita: el borde cuarzo–calcita pasa por los puntos de la cátedra (±0,006 g/cm³)', () => {
    const p = pairs('D', 'E');
    expect(p.length).toBeGreaterThanOrEqual(9);
    for (const [u, rho] of p) expect(Math.abs(edgeAt(Q, C, u) - rho), `Umaa ${u}`).toBeLessThan(0.006);
  });
  it('cuarzo → dolomita (±0,006 g/cm³)', () => {
    const p = pairs('F', 'G');
    expect(p.length).toBe(5);
    for (const [u, rho] of p) expect(Math.abs(edgeAt(Q, D, u) - rho), `Umaa ${u}`).toBeLessThan(0.006);
  });
  it('dolomita → calcita (±0,006 g/cm³)', () => {
    const p = pairs('H', 'I');
    expect(p.length).toBe(6);
    for (const [u, rho] of p) expect(Math.abs(edgeAt(D, C, u) - rho), `Umaa ${u}`).toBeLessThan(0.006);
  });
  it('vértices: cuarzo (4,8; 2,65), dolomita (9; 2,87) y calcita (13,8; ≈2,71)', () => {
    expect([Q.u, Q.rho]).toEqual([num('D65'), num('E65')]);
    expect([D.u, D.rho]).toEqual([num('F69'), num('G69')]);
    expect(C.u).toBe(num('H74'));
    expect(Math.abs(C.rho - num('I74')!)).toBeLessThan(0.005);
  });
});

describe('PEF contra Th/K: cajas iguales a los polígonos de la cátedra (columnas X:Z)', () => {
  // Agrupa los vértices por mineral: la fila con nombre en X abre un polígono que sigue en las filas siguientes.
  const polygons = new Map<string, [number, number][]>();
  let current: string | null = null;
  for (let row = 30; row <= 80; row++) {
    const name = cells.get(`X${row}`);
    if (typeof name === 'string') { current = name; polygons.set(name, []); }
    const y = num(`Y${row}`);
    const z = num(`Z${row}`);
    if (current && y !== undefined && z !== undefined) polygons.get(current)!.push([y, z]);
  }
  const names: Record<string, string> = {
    Glauconita: 'glauconite', Biotita: 'biotite', Clorita: 'chlorite', Illita: 'illite', 'Mixed Layer': 'mixed-layer',
    Montmorillonita: 'montmorillonite', Caolinita: 'kaolinite', Muscovita: 'muscovite',
  };

  it('ocho minerales en la hoja, ocho cajas en el motor', () => {
    expect([...polygons.keys()].sort()).toEqual(Object.keys(names).sort());
    expect(LITH1_BOXES.filter((b) => b.thk)).toHaveLength(8);
  });
  it.each(Object.entries(names))('%s', (sheet, id) => {
    const box = LITH1_BOXES.find((b) => b.id === id)!;
    expect(boxVertices(box.thk!, box.pe)).toEqual(polygons.get(sheet));
  });
  it('la capa de la plantilla dibuja esas mismas cajas', () => {
    const layers = lithologyTemplateLayers('pe-thk');
    expect(layers.polygons.map((p) => p.label)).toEqual(LITH1_BOXES.map((b) => b.label));
    const glauc = layers.polygons.find((p) => p.id === 'lith1-glauconite')!;
    expect(glauc.vertices).toEqual(polygons.get('Glauconita'));
  });
  it('PEF–K: mismas bandas de PEF, sin capas mixtas (la carta no la trae contra K)', () => {
    const layers = lithologyTemplateLayers('pe-k');
    expect(layers.polygons).toHaveLength(7);
    expect(layers.polygons.some((p) => p.id === 'lith1-mixed-layer')).toBe(false);
    expect(layers.info).toContain('SIN VERIFICAR');
  });
});

describe('flechas de la carta', () => {
  it('la punta queda en el destino y las alas a los dos lados', () => {
    const a = arrowPath([15, 2.8], [17, 2.8], [15, 0.9]);
    expect([a.x[1], a.y[1]]).toEqual([17, 2.8]);
    expect(a.x[2]!).toBeLessThan(17);
    expect(Math.sign(a.y[2]! - 2.8)).toBe(-Math.sign(a.y[4]! - 2.8));
  });
});

// ── el módulo sobre los perfiles del TP ───────────────────────────────────────────────────────────────────────

describe('módulo «Índices de litología» con el pozo del TP', () => {
  const { well, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(toEngineWell(well));
  const result = engine.run(emptyInterpretation(zones));
  const curve = (port: string) => result.outputs.find((o) => o.port === port && o.moduleId === 'lithology-indices')?.value as Float64Array | undefined;
  const median = (a: Float64Array) => { const v = Array.from(a).filter(Number.isFinite).sort((x, y) => x - y); return v[v.length >> 1]!; };

  it('publica M, N, Umaa, Δtmaa y Th/K con datos y sin errores', () => {
    for (const port of ['M', 'N', 'UMAA', 'DTMAA', 'THK']) {
      const c = curve(port);
      expect(c, port).toBeDefined();
      expect(Array.from(c!).filter(Number.isFinite).length, port).toBeGreaterThan(well.depth.values.length / 2);
    }
    expect(result.diagnostics.filter((d) => d.moduleId === 'lithology-indices' && d.level === 'error')).toEqual([]);
    expect(result.diagnostics.filter((d) => d.moduleId === 'lithology-indices' && d.message.includes('solo del sónico'))).toEqual([]);
  });

  it('valores del TP en rangos físicos; Umaa muy alto por baritina, mientras MID (Δtmaa, ρmaa) limpio cae en cuarzo–calcita', () => {
    expect(median(curve('M')!)).toBeGreaterThan(0.5);
    expect(median(curve('M')!)).toBeLessThan(0.9);
    expect(median(curve('N')!)).toBeGreaterThan(0.45);
    expect(median(curve('N')!)).toBeLessThan(0.7);
    expect(median(curve('UMAA')!)).toBeGreaterThan(13.8);
    expect(median(curve('THK')!)).toBeGreaterThan(2);
    expect(median(curve('THK')!)).toBeLessThan(15);

    const dtmaa = curve('DTMAA')!;
    const rhomaa = result.outputs.find((o) => o.port === 'RHOMAA')?.value as Float64Array;
    const vsh = result.outputs.find((o) => o.port === 'VSH' && o.active)?.value as Float64Array;
    const cleanDt: number[] = [];
    const cleanRho: number[] = [];
    for (let i = 0; i < dtmaa.length; i++) {
      if (vsh[i]! <= 0.3 && Number.isFinite(dtmaa[i]!) && Number.isFinite(rhomaa[i]!)) {
        cleanDt.push(dtmaa[i]!);
        cleanRho.push(rhomaa[i]!);
      }
    }
    expect(cleanDt.length).toBeGreaterThan(500);
    const medCleanDt = median(Float64Array.from(cleanDt));
    const medCleanRho = median(Float64Array.from(cleanRho));
    // Nube limpia en el campo cuarzo (55,5; 2,65) – calcita (47,5; 2,71), inmune a la baritina del PEF.
    expect(medCleanDt).toBeGreaterThan(45);
    expect(medCleanDt).toBeLessThan(60);
    expect(medCleanRho).toBeGreaterThan(2.6);
    expect(medCleanRho).toBeLessThan(2.76);
  });

  it('Δtmaa y ρmaa son bit a bit inmunes a un PEF contaminado por baritina, a diferencia de Umaa', () => {
    const bariteWell = {
      ...well,
      curves: well.curves.map((c) => (c.role === 'PEF' ? { ...c, data: Float64Array.from(c.data, (v) => (Number.isFinite(v) ? v * 5 : v)) } : c)),
    };
    const eng2 = new Engine(registry, { checkInputs: true });
    eng2.setWell(toEngineWell(bariteWell));
    const res2 = eng2.run(emptyInterpretation(zones));
    const dt1 = curve('DTMAA')!;
    const dt2 = res2.outputs.find((o) => o.port === 'DTMAA' && o.moduleId === 'lithology-indices')?.value as Float64Array;
    const u1 = curve('UMAA')!;
    const u2 = res2.outputs.find((o) => o.port === 'UMAA' && o.moduleId === 'lithology-indices')?.value as Float64Array;
    expect(Array.from(dt2)).toEqual(Array.from(dt1));
    expect(median(u2)).toBeGreaterThan(median(u1) * 4);
  });

  it('avisa circularidad si PHIT sale solo del sónico (PHIT = PHIS), sin falsos positivos en roca compacta ni DT parcial/vacío', () => {
    const interp = emptyInterpretation(zones);
    interp.params.global['phit.method'] = 'sonic';
    const resSonic = engine.run(interp);
    const warns = resSonic.diagnostics.filter((d) => d.moduleId === 'lithology-indices' && d.level === 'warning' && d.message.includes('solo del sónico'));
    expect(warns.length).toBeGreaterThan(0);

    const runSynth = (curves: { id: string; role: string; unit: string; data: number[] }[], method?: string) => {
      const len = curves[0]!.data.length;
      const w = createWell({
        id: 'synth',
        name: 'Synth',
        depth: Float64Array.from({ length: len }, (_, i) => 1000 + i),
        curves: curves.map((c) => ({ id: c.id, mnemonic: c.id, role: c.role, unit: c.unit, data: Float64Array.from(c.data), origin: { kind: 'measured' as const } })),
      });
      const eng = new Engine(registry, { checkInputs: true });
      eng.setWell(toEngineWell(w));
      const itSynth = emptyInterpretation([]);
      if (method) itSynth.params.global['phit.method'] = method;
      return eng.run(itSynth);
    };

    // Caso 1: caliza compacta (PHID = PHIN = PHIT = PHIS = 0 recortado) → DTMAA = 47,5, NO es circular.
    const tight = runSynth([
      { id: 'RHOB', role: 'RHOB', unit: 'g/cm3', data: [2.71, 2.71, 2.71, 2.71] },
      { id: 'NPHI', role: 'NPHI', unit: 'v/v', data: [0, 0, 0, 0] },
      { id: 'DT', role: 'DT', unit: 'us/ft', data: [47.5, 47.5, 47.5, 47.5] },
    ], 'densityNeutron');
    const tightDtmaa = tight.outputs.find((o) => o.port === 'DTMAA')?.value as Float64Array;
    expect(tightDtmaa[0]).toBeCloseTo(47.5, 10);
    expect(tight.diagnostics.filter((d) => d.moduleId === 'lithology-indices' && d.message.includes('solo del sónico'))).toEqual([]);

    // Caso 2: DT parcial (1 muestra válida que coincide con PHIT y el resto NaN) → NO es circular.
    const partial = runSynth([
      { id: 'RHOB', role: 'RHOB', unit: 'g/cm3', data: Array(6).fill(2.32) },
      { id: 'NPHI', role: 'NPHI', unit: 'v/v', data: Array(6).fill(0.2) },
      { id: 'DT', role: 'DT', unit: 'us/ft', data: [82.2, NaN, NaN, NaN, NaN, NaN] },
    ], 'densityNeutron');
    expect(partial.diagnostics.filter((d) => d.moduleId === 'lithology-indices' && d.message.includes('solo del sónico'))).toEqual([]);

    // Caso 3: DT todo NaN con PHIS medida que alimenta PHIT → DTMAA sin dato, no emite aviso de circularidad.
    const noDt = runSynth([
      { id: 'RHOB', role: 'RHOB', unit: 'g/cm3', data: [2.4, 2.4, 2.4, 2.4] },
      { id: 'DT', role: 'DT', unit: 'us/ft', data: [NaN, NaN, NaN, NaN] },
      { id: 'PHIS', role: 'PHIS', unit: 'v/v', data: [0.2, 0.2, 0.2, 0.2] },
    ], 'sonic');
    expect(noDt.diagnostics.filter((d) => d.moduleId === 'lithology-indices' && d.message.includes('solo del sónico'))).toEqual([]);
  });

  it('las siete plantillas se arman con el TP y MID incluye 5 vértices, grilla 20 % y 3 flechas orientativas', () => {
    const computed = result.outputs.flatMap((o) => (o.kind === 'curve' && o.value instanceof Float64Array ? [{ port: o.port, moduleId: o.moduleId, label: o.label, data: o.value, active: o.active }] : []));
    const ctx: SeriesContext = { well, interpretation: emptyInterpretation(zones), computed, catalog: registry.roles };
    for (const id of LITHOLOGY_TEMPLATE_IDS) expect(crossplotTemplatePatch(ctx, id).ok, id).toBe(true);

    const midLayers = lithologyTemplateLayers('mid');
    expect(midLayers.points.map((p) => p.name)).toEqual(MID_VERTICES.map((v) => v.label));
    expect(midLayers.lines.filter((l) => l.id.startsWith('mid-grid-'))).toHaveLength(12);
    expect(midLayers.lines.some((l) => l.id === 'mid-triangle')).toBe(true);
    const gas = midLayers.lines.find((l) => l.id === 'arrow-mid-gas')!;
    const sec = midLayers.lines.find((l) => l.id === 'arrow-mid-secondary')!;
    const clay = midLayers.lines.find((l) => l.id === 'arrow-mid-clay')!;
    // Gas: baja ρmaa (hacia arriba con eje y invertido).
    expect(gas.y[1]!).toBeLessThan(gas.y[0]!);
    // Porosidad secundaria: baja Δtmaa (hacia la izquierda).
    expect(sec.x[1]!).toBeLessThan(sec.x[0]!);
    // Arcilla: sube Δtmaa y sube ρmaa (abajo a la derecha).
    expect(clay.x[1]!).toBeGreaterThan(clay.x[0]!);
    expect(clay.y[1]!).toBeGreaterThan(clay.y[0]!);
  });

  it('los roles nuevos están en el catálogo con unidad y escala, y Ecuaciones documenta Clavier & Rust (1976)', () => {
    expect(registry.roles.get('THK')?.display?.scale).toBe('log');
    expect(registry.roles.get('UMAA')?.unit).toBe('unitless');
    expect(registry.roles.get('DTMAA')?.unit).toBe('us/ft');
    expect(registry.roles.get('DTMAA')?.display?.scale).toBe('linear');
    expect(defaultRoleCatalog.get('THK')).toBeUndefined();
    expect(defaultRoleCatalog.get('DTMAA')).toBeUndefined();
    expect(lithologyIndicesModule.docs.equations.some((e) => e.latex.includes('\\Delta t_{maa}'))).toBe(true);
    expect(lithologyIndicesModule.docs.references.some((r) => r.includes('Clavier') && r.includes('1976'))).toBe(true);
  });
});
