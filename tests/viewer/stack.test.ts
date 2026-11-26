/**
 * Pila volumétrica (fase 4b): cierre a 1, recortes, NaN como hueco, entradas faltantes y que sea genérica (otra pila
 * de mineralogía se declara sin tocar el dibujante). Valores de libro: arcilla = VSH, matriz = 1 − VSH − PHIE,
 * agua = PHIE·SW, hidrocarburo = PHIE·(1 − SW).
 */
import { describe, expect, it } from 'vitest';
import type { StackSpec, TrackSpec } from '../../src/core/display';
import { sanitizeDisplay } from '../../src/core/display';
import { defaultRoleCatalog } from '../../src/core/roles';
import type { Curve } from '../../src/core/well';
import { resolveTracks, type ComputedCurve } from '../../src/viewer/resolve';
import { clampChildDecimatedSpan, computeStack, stackHint, stackReadout } from '../../src/viewer/stack';
import { BUILTIN_LAYOUTS, STACK_ROLE_HINTS, VOLUMETRIC_STACK } from '../../src/viewer/templates';

const arr = (...v: number[]) => Float64Array.from(v);
const source = (m: Record<string, Float64Array>) => (role: string) => m[role];
const layer = (r: ReturnType<typeof computeStack>, id: string) => r.layers.find((l) => l.id === id)!;
const width = (r: ReturnType<typeof computeStack>, id: string, i: number) => layer(r, id).right[i]! - layer(r, id).left[i]!;

describe('pila volumétrica', () => {
  it('reparte arcilla, matriz, agua e hidrocarburo y cierra a 1', () => {
    const r = computeStack(VOLUMETRIC_STACK, 1, source({ VSH: arr(0.2), PHIE: arr(0.25), SW: arr(0.4) }));
    expect(r.empty).toBe(false);
    expect(r.missing).toEqual([]);
    expect(width(r, 'shale', 0)).toBeCloseTo(0.2, 6);
    expect(width(r, 'matrix', 0)).toBeCloseTo(0.55, 6);
    expect(width(r, 'water', 0)).toBeCloseTo(0.1, 6);
    expect(width(r, 'hydrocarbon', 0)).toBeCloseTo(0.15, 6);
    // Orden de izquierda a derecha y cierre: el último borde es 1.
    expect(layer(r, 'shale').left[0]).toBe(0);
    expect(layer(r, 'matrix').left[0]).toBeCloseTo(0.2, 6);
    expect(layer(r, 'water').left[0]).toBeCloseTo(0.75, 6);
    expect(layer(r, 'hydrocarbon').right[0]).toBeCloseTo(1, 6);
    // La porosidad (padre) cubre exactamente agua + hidrocarburo, y se dibuja antes que sus hijos.
    expect(width(r, 'pore', 0)).toBeCloseTo(0.25, 6);
    expect(r.layers.findIndex((l) => l.id === 'pore')).toBeLessThan(r.layers.findIndex((l) => l.id === 'water'));
    expect(r.legend.map((l) => l.label)).toEqual(['Arcilla', 'Matriz', 'Agua', 'Hidrocarburo']);
    const read = stackReadout(r, 0);
    expect(read.get('water')).toBeCloseTo(0.1, 6);
  });

  it('cierra a 1 en cualquier muestra (pozo con valores variados)', () => {
    const n = 200;
    const vsh = Float64Array.from({ length: n }, (_, i) => (i % 17) / 16);
    const phie = Float64Array.from({ length: n }, (_, i) => ((i * 7) % 11) / 25);
    const sw = Float64Array.from({ length: n }, (_, i) => ((i * 3) % 13) / 12);
    const r = computeStack(VOLUMETRIC_STACK, n, source({ VSH: vsh, PHIE: phie, SW: sw }));
    for (let i = 0; i < n; i++) {
      const total = ['shale', 'matrix', 'water', 'hydrocarbon'].reduce((s, id) => s + width(r, id, i), 0);
      expect(total).toBeCloseTo(1, 5);
      for (const l of r.layers) expect(l.right[i]! - l.left[i]!).toBeGreaterThanOrEqual(-1e-7);
    }
  });

  it('recorta a [0, 1] y normaliza si VSH + PHIE > 1', () => {
    const r = computeStack(VOLUMETRIC_STACK, 3, source({ VSH: arr(1.3, -0.2, 0.7), PHIE: arr(0.1, 0.2, 0.5), SW: arr(1.4, -1, 0.5) }));
    // VSH 1,3 → 1; con PHIE 0,1 la suma es 1,1 → se normaliza (proporciones 1 : 0,1) y la matriz queda en 0.
    expect(width(r, 'shale', 0)).toBeCloseTo(1 / 1.1, 6);
    expect(width(r, 'matrix', 0)).toBeCloseTo(0, 6);
    expect(width(r, 'water', 0)).toBeCloseTo(0.1 / 1.1, 6); // SW 1,4 → 1: todo agua
    expect(width(r, 'hydrocarbon', 0)).toBeCloseTo(0, 6);
    // VSH −0,2 → 0; SW −1 → 0: todo hidrocarburo.
    expect(width(r, 'shale', 1)).toBeCloseTo(0, 6);
    expect(width(r, 'hydrocarbon', 1)).toBeCloseTo(0.2, 6);
    // 0,7 + 0,5 = 1,2 → 0,5833 + 0,4167.
    expect(width(r, 'shale', 2)).toBeCloseTo(0.7 / 1.2, 6);
    expect(width(r, 'pore', 2)).toBeCloseTo(0.5 / 1.2, 6);
    expect(layer(r, 'hydrocarbon').right[2]).toBeCloseTo(1, 6);
  });

  it('NaN: en VSH o PHIE la muestra es hueco; en SW la porosidad queda entera', () => {
    const r = computeStack(VOLUMETRIC_STACK, 3, source({ VSH: arr(NaN, 0.2, 0.2), PHIE: arr(0.2, NaN, 0.2), SW: arr(0.5, 0.5, NaN) }));
    for (const l of r.layers) {
      expect(l.left[0]).toBeNaN();
      expect(l.left[1]).toBeNaN();
    }
    expect(width(r, 'pore', 2)).toBeCloseTo(0.2, 6);
    expect(layer(r, 'water').left[2]).toBeNaN();
    expect(layer(r, 'hydrocarbon').left[2]).toBeNaN();
  });

  it('con solo VSH dibuja arcilla y un resto sin partir (sin inventar matriz)', () => {
    const r = computeStack(VOLUMETRIC_STACK, 1, source({ VSH: arr(0.3) }));
    expect(r.empty).toBe(false);
    expect(r.missing).toEqual(['PHIE', 'SW']);
    expect(r.layers.map((l) => l.id)).toEqual(['shale', 'matrix']);
    const rest = layer(r, 'matrix');
    expect(rest.label).toBe('Resto sin partir');
    expect(rest.fill).toBe('undivided');
    expect(width(r, 'matrix', 0)).toBeCloseTo(0.7, 6);
    expect(stackHint(r, STACK_ROLE_HINTS)).toBe('Faltan PHIE (paso Porosidad) y SW (paso Saturación).');
  });

  it('con VSH y PHIE sin SW la porosidad no se parte', () => {
    const r = computeStack(VOLUMETRIC_STACK, 1, source({ VSH: arr(0.3), PHIE: arr(0.2) }));
    expect(r.missing).toEqual(['SW']);
    expect(r.layers.map((l) => l.id)).toEqual(['shale', 'matrix', 'pore']);
    expect(layer(r, 'matrix').label).toBe('Matriz');
    expect(r.legend.map((l) => l.label)).toEqual(['Arcilla', 'Matriz', 'Porosidad']);
  });

  it('sin entradas queda vacía y dice qué falta (IGR no sustituye a VSH)', () => {
    const r = computeStack(VOLUMETRIC_STACK, 2, source({ IGR: arr(0.4, 0.5) }));
    expect(r.empty).toBe(true);
    expect(r.layers).toEqual([]);
    expect(stackHint(r, STACK_ROLE_HINTS)).toBe('Faltan VSH (paso Arcilla), PHIE (paso Porosidad) y SW (paso Saturación).');
  });

  it('es genérica: una pila de mineralogía se declara sin tocar el dibujante', () => {
    const mineral: StackSpec = {
      components: [
        { id: 'calc', label: 'Calcita', fill: 'limestone', factors: [{ role: 'VCALC' }] },
        { id: 'dol', label: 'Dolomía', fill: 'dolomite', factors: [{ role: 'VDOL' }] },
        { id: 'qtz', label: 'Cuarzo', fill: 'sand', rest: true },
      ],
    };
    const r = computeStack(mineral, 1, source({ VCALC: arr(0.5), VDOL: arr(0.2) }));
    expect(r.legend.map((l) => l.id)).toEqual(['calc', 'dol', 'qtz']);
    expect(width(r, 'qtz', 0)).toBeCloseTo(0.3, 6);
  });

  it('G07: con MOS y SHR parte hidrocarburo en móvil (PHIE·MOS) y residual (PHIE·(1−SXO)) sin afectar pozos sin RXO', () => {
    // Muestra 0: SW=0,2, SXO=0,7 → MOS=0,5, SHR=0,3, PHIE=0,25 → móvil=0,125, residual=0,075, suma=0,20 = PHIE·(1−SW)
    // Muestra 1: RXO = NaN → MOS=NaN, SHR=NaN → el padre hidrocarburo (0,15) queda entero sin huecos
    // Muestra 2: SW=1, SXO=1 → MOS=0, SHR=0 → ambos nietos ancho 0 (no NaN)
    // Muestra 3: SW=NaN → limpia agua, hidrocarburo y nietos, dejando porosidad entera
    const r = computeStack(
      VOLUMETRIC_STACK,
      4,
      source({
        VSH: arr(0.1, 0.2, 0.1, 0.1),
        PHIE: arr(0.25, 0.25, 0.2, 0.2),
        SW: arr(0.2, 0.4, 1.0, NaN),
        MOS: arr(0.5, NaN, 0.0, NaN),
        SHR: arr(0.3, NaN, 0.0, NaN),
      }),
    );
    expect(r.missing).toEqual([]);
    // Orden de capas: nivel 0 < nivel 1 < nivel 2
    expect(r.layers.findIndex((l) => l.id === 'hydrocarbon')).toBeLessThan(r.layers.findIndex((l) => l.id === 'movable-hc'));
    expect(layer(r, 'movable-hc').level).toBe(2);
    expect(layer(r, 'residual-hc').level).toBe(2);
    // Leyenda conserva Hidrocarburo porque muestra 1 cae al padre
    expect(r.legend.map((l) => l.id)).toEqual(['shale', 'matrix', 'water', 'hydrocarbon', 'movable-hc', 'residual-hc']);
    // Muestra 0: partición exacta
    expect(width(r, 'water', 0)).toBeCloseTo(0.05, 6);
    expect(width(r, 'movable-hc', 0)).toBeCloseTo(0.125, 6);
    expect(width(r, 'residual-hc', 0)).toBeCloseTo(0.075, 6);
    expect(layer(r, 'movable-hc').left[0]).toBeCloseTo(layer(r, 'hydrocarbon').left[0]!, 6);
    expect(layer(r, 'residual-hc').right[0]).toBeCloseTo(1, 6);
    // Muestra 1: MOS/SHR NaN → nietos NaN y padre hidrocarburo entero (0,15)
    expect(width(r, 'hydrocarbon', 1)).toBeCloseTo(0.15, 6);
    expect(layer(r, 'movable-hc').left[1]).toBeNaN();
    expect(layer(r, 'residual-hc').left[1]).toBeNaN();
    // Muestra 2: SW=1 → nietos con ancho 0
    expect(width(r, 'movable-hc', 2)).toBeCloseTo(0, 6);
    expect(width(r, 'residual-hc', 2)).toBeCloseTo(0, 6);
    // Muestra 3: SW=NaN → nietos también NaN y porosidad entera
    expect(width(r, 'pore', 3)).toBeCloseTo(0.2, 6);
    expect(layer(r, 'hydrocarbon').left[3]).toBeNaN();
    expect(layer(r, 'movable-hc').left[3]).toBeNaN();
    expect(layer(r, 'residual-hc').left[3]).toBeNaN();
    // Si MOS/SHR están todos en NaN, no se activa la partición opcional (misma leyenda que sin RXO)
    const allNan = computeStack(
      VOLUMETRIC_STACK,
      2,
      source({ VSH: arr(0.2, 0.2), PHIE: arr(0.2, 0.2), SW: arr(0.3, 0.4), MOS: arr(NaN, NaN), SHR: arr(NaN, NaN) }),
    );
    expect(allNan.legend.map((l) => l.id)).toEqual(['shale', 'matrix', 'water', 'hydrocarbon']);
    expect(allNan.missing).toEqual([]);

    // Regresión hallazgo 5: MOS y SHR finitos en índices disjuntos (o solo donde VSH = NaN) no dejan leyenda fantasma
    const disjoint = computeStack(
      VOLUMETRIC_STACK,
      2,
      source({ VSH: arr(0.2, 0.2), PHIE: arr(0.2, 0.2), SW: arr(0.3, 0.4), MOS: arr(0.4, NaN), SHR: arr(NaN, 0.3) }),
    );
    expect(disjoint.legend.map((l) => l.id)).toEqual(['shale', 'matrix', 'water', 'hydrocarbon']);
    expect(disjoint.layers.some((l) => l.id === 'movable-hc' || l.id === 'residual-hc')).toBe(false);

    // Regresión hallazgo 3: acotado bajo decimación impide que movable-hc invada el tramo del padre/agua
    const pXa = Float32Array.from([70, NaN]);
    const pXb = Float32Array.from([100, NaN]);
    const cXa = Float32Array.from([62, 65]);
    const cXb = Float32Array.from([85, 90]);
    clampChildDecimatedSpan(cXa, cXb, pXa, pXb, 2);
    expect(cXa[0]).toBe(70);
    expect(cXb[0]).toBe(85);
    expect(cXa[1]).toBeNaN();
    expect(cXb[1]).toBeNaN();
    expect(layer(r, 'movable-hc').parentId).toBe('hydrocarbon');
  });
});

describe('pista volumétrica en el visor', () => {
  const n = 4;
  const depth = Float64Array.from({ length: n }, (_, i) => 1000 + i);
  const layout: TrackSpec[] = [{ id: 'vol', title: 'Volumétrica', kind: 'stack', stack: VOLUMETRIC_STACK }];
  const computed = (port: string, v: number, active = true): ComputedCurve => ({ port, moduleId: `m-${port}-${active}`, label: port, data: new Float64Array(n).fill(v), active });

  it('está en la plantilla de Petrofísica y aparece vacía si no hay entradas', () => {
    expect(BUILTIN_LAYOUTS.petrophysics.some((t) => t.kind === 'stack' && t.stack === VOLUMETRIC_STACK)).toBe(true);
    const [t] = resolveTracks(layout, { depth, curves: [], computed: [], catalog: defaultRoleCatalog });
    expect(t!.kind).toBe('stack');
    expect(t!.stack!.empty).toBe(true);
  });

  it('toma la calculada ACTIVA, no la alternativa ni IGR', () => {
    const igr: Curve = { id: 'IGR', mnemonic: 'IGR', role: 'IGR', unit: 'v/v', data: new Float64Array(n).fill(0.9), origin: { kind: 'measured' } };
    const [t] = resolveTracks(layout, { depth, curves: [igr], computed: [computed('VSH', 0.9, false), computed('VSH', 0.25)], catalog: defaultRoleCatalog });
    const shale = t!.stack!.layers.find((l) => l.id === 'shale')!;
    expect(shale.right[0]! - shale.left[0]!).toBeCloseTo(0.25, 6);
  });

  it('convierte una PHIE medida en % a v/v', () => {
    const phie: Curve = { id: 'PHIE', mnemonic: 'PHIE', role: 'PHIE', unit: '%', data: new Float64Array(n).fill(20), origin: { kind: 'measured' } };
    const [t] = resolveTracks(layout, { depth, curves: [phie], computed: [computed('VSH', 0.1)], catalog: defaultRoleCatalog });
    const pore = t!.stack!.layers.find((l) => l.id === 'pore')!;
    expect(pore.right[0]! - pore.left[0]!).toBeCloseTo(0.2, 6);
  });

  it('no recalcula la pila si las entradas no cambiaron (caché por identidad)', () => {
    const c = [computed('VSH', 0.3)];
    const a = resolveTracks(layout, { depth, curves: [], computed: c, catalog: defaultRoleCatalog });
    const b = resolveTracks(layout, { depth, curves: [], computed: c, catalog: defaultRoleCatalog });
    expect(b[0]!.stack).toBe(a[0]!.stack);
  });

  it('se guarda y se valida al abrir el proyecto', () => {
    const warns: string[] = [];
    const d = sanitizeDisplay({ layouts: { petrophysics: [layout[0], { id: 'x', title: 'X', kind: 'stack', stack: { components: [{ id: 'a' }] } }] } }, (m) => warns.push(m));
    expect(d.layouts['petrophysics']!.map((t) => t.id)).toEqual(['vol']);
    expect(d.layouts['petrophysics']![0]!.stack).toEqual(VOLUMETRIC_STACK);
    expect(warns.some((w) => w.includes("'x'"))).toBe(true);
  });
});
