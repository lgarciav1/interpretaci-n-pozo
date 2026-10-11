/**
 * Calculadora de agua de formación — lógica del panel (src/modules/formation-water/model.ts) y su empalme con
 * `rw-manual`: el Rw escrito por «Usar como Rw manual» reproduce el Rw de la calculadora a la temperatura elegida.
 * Las cuentas de la correlación están en tests/petro-agua.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { Engine } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import { registry } from '../src/modules';
import { FORMATION_WATER_DOCS } from '../src/modules/formation-water/docs';
import { chooseTempProfile, gradientTemperature, manualRwWrite, rwDepthSeries, temperatureAt, zoneTopRows } from '../src/modules/formation-water/model';
import { naclResistivityC } from '../src/petro/brine';
import { collectDockPanels } from '../src/app/shell/dockPanels';
import { PLOT_PARAMS } from '../src/plots/params';
import { curve, well, zone } from './helpers';

// Gradiente de 3 °C/100 m desde 20 °C en superficie, datum 0 → T(z) = 20 + 0,03·z (a mano).
const GRADIENT = { tSurface: 20, gradientPer100m: 3, datum: 0 };
const DEPTH = Float64Array.from({ length: 5 }, (_, i) => 1000 + i * 500); // 1000, 1500, 2000, 2500, 3000 m

describe('perfil de temperatura', () => {
  it('el gradiente da 20 + 0,03·z (a mano) y respeta el datum', () => {
    expect(Array.from(gradientTemperature(DEPTH, GRADIENT))).toEqual([50, 65, 80, 95, 110].map((v) => expect.closeTo(v, 10)));
    expect(gradientTemperature([1000], { ...GRADIENT, datum: 200 })[0]).toBeCloseTo(20 + 0.03 * 800, 10);
  });

  it('prefiere la curva calculada, después la medida y al final el gradiente', () => {
    const computed = Float64Array.from([1, 2, 3, 4, 5]);
    const measured = Float64Array.from([6, 7, 8, 9, 10]);
    expect(chooseTempProfile(DEPTH, { computed, measured }, GRADIENT).source).toBe('computed');
    expect(chooseTempProfile(DEPTH, { measured }, GRADIENT).source).toBe('measured');
    expect(chooseTempProfile(DEPTH, {}, GRADIENT).source).toBe('gradient');
    // una curva vacía o de otro largo se descarta
    expect(chooseTempProfile(DEPTH, { computed: new Float64Array(5).fill(NaN), measured }, GRADIENT).source).toBe('measured');
    expect(chooseTempProfile(DEPTH, { computed: new Float64Array(3).fill(1) }, GRADIENT).source).toBe('gradient');
  });

  it('interpola la temperatura a una profundidad', () => {
    const p = chooseTempProfile(DEPTH, {}, GRADIENT);
    expect(temperatureAt(p, 1750)).toBeCloseTo(72.5, 10);
    expect(temperatureAt(p, 999)).toBeNaN();
    expect(temperatureAt(p, 3001)).toBeNaN();
  });
});

describe('Rw por zona y a lo largo del pozo', () => {
  const profile = chooseTempProfile(DEPTH, {}, GRADIENT);
  // Rw 0,1 ohm·m medida a 20 °C. Arps en °C (a mano): R·(1,8·20 + 38,77)/(1,8·T + 38,77) = 0,1·74,77/(1,8·T + 38,77)
  const arps = (t: number) => (0.1 * 74.77) / (1.8 * t + 38.77);

  it('en el tope de cada zona, en orden de profundidad', () => {
    const rows = zoneTopRows(
      [
        { id: 'b', name: 'B', top: 2000 },
        { id: 'a', name: 'A', top: 1000 },
        { id: 'fuera', name: 'F', top: 5000 },
      ],
      profile,
      0.1,
      20,
    );
    expect(rows.map((r) => r.name)).toEqual(['A', 'B', 'F']);
    expect(rows[0]!.tempC).toBeCloseTo(50, 10);
    expect(rows[0]!.rw).toBeCloseTo(arps(50), 10);
    expect(rows[1]!.rw).toBeCloseTo(arps(80), 10);
    expect(rows[2]!.tempC).toBeNaN(); // tope fuera del perfil
    expect(rows[2]!.rw).toBeNaN();
  });

  it('la Rw baja al aumentar la profundidad y la serie está acotada', () => {
    const s = rwDepthSeries(profile, 0.1, 20, 3);
    expect(s.depth.length).toBeLessThanOrEqual(3);
    expect(s.rw.length).toBe(s.depth.length);
    for (let i = 1; i < s.rw.length; i++) expect(s.rw[i]!).toBeLessThan(s.rw[i - 1]!);
    expect(rwDepthSeries(profile, NaN, 20).rw).toEqual([]);
  });
});

describe('«Usar como Rw manual»', () => {
  it('redondea Rw a 4 decimales y T a 0,1 °C', () => {
    expect(manualRwWrite(0.11104058, 100.04)).toEqual({ ok: true, rwRef: 0.111, tRef: 100, converted: false });
    expect(manualRwWrite(0.07353, 23.94)).toEqual({ ok: true, rwRef: 0.0735, tRef: 23.9, converted: false });
  });

  it('bordes inclusivos del control (T 0–200 °C) sin conversión; Rw 0,005–5 sin recortar', () => {
    expect(manualRwWrite(0.005, 0)).toMatchObject({ ok: true, converted: false });
    expect(manualRwWrite(5, 200)).toMatchObject({ ok: true, converted: false });
    const bajo = manualRwWrite(0.004, 80);
    expect(bajo.ok).toBe(false);
    expect(!bajo.ok && bajo.reason).toContain('0,005');
    expect(manualRwWrite(6, 80).ok).toBe(false);
    expect(manualRwWrite(NaN, 80).ok).toBe(false);
    expect(manualRwWrite(0.1, NaN).ok).toBe(false);
    expect(manualRwWrite(0.1, -30).ok).toBe(false); // −30 °C: fuera de la corrección de Arps
  });

  it('fuera de 0–200 °C se guarda la MISMA agua a 75 °F (23,9 °C) con Arps', () => {
    // 20 000 ppm a 262 °C (pozo profundo): la Rw a 262 °C es 0,0476; a 23,9 °C es la de la correlación a 75 °F, 0,2971.
    const rw262 = naclResistivityC(20_000, 262);
    const w = manualRwWrite(rw262, 262);
    expect(w).toMatchObject({ ok: true, converted: true, tRef: 23.9 });
    if (!w.ok) return;
    expect(Math.abs(w.rwRef - 0.2971) / 0.2971).toBeLessThan(1e-3);
    // el módulo (Arps) la lleva de vuelta a 262 °C: coincide con la Rw original
    const back = (w.rwRef * (23.9 * 1.8 + 38.77)) / (262 * 1.8 + 38.77);
    expect(Math.abs(back - rw262) / rw262).toBeLessThan(1e-3);
    const frio = manualRwWrite(naclResistivityC(20_000, -5), -5);
    expect(frio).toMatchObject({ ok: true, converted: true });
    // un agua muy dulce no cabe aunque se convierta (Rw a 23,9 °C > 5 ohm·m)
    const dulce = manualRwWrite(naclResistivityC(500, 262), 262);
    expect(dulce.ok).toBe(false);
    expect(!dulce.ok && dulce.reason).toContain('23,9');
  });

  it('las claves de almacenamiento son las de rw-manual y el motor reproduce la Rw de la calculadora', () => {
    expect(PLOT_PARAMS.rwRef.storage).toBe('rw-manual.rwRef');
    expect(PLOT_PARAMS.tRef.storage).toBe('rw-manual.tRef');

    // 20 000 ppm a 80 °C según la calculadora → se escribe → el módulo da esa Rw en una muestra a 80 °C.
    const rwCalc = naclResistivityC(20_000, 80);
    const w = manualRwWrite(rwCalc, 80);
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const zones = [zone('z', 1000, 1004.5)];
    const engine = new Engine(registry, { checkInputs: true });
    engine.setWell(well([curve('TEMP', 'TEMP', [80, 80, 100, 100, 60, 60, 80, 80, 80, 80])], 10, 1000, 0.5));
    const r = engine.run({
      ...emptyInterpretation(zones),
      params: { global: { [PLOT_PARAMS.rwRef.storage]: w.rwRef, [PLOT_PARAMS.tRef.storage]: w.tRef }, zones: {} },
    });
    const rw = r.outputs.find((o) => o.key === 'rw-manual:RW')!.value as Float64Array;
    expect(Math.abs(rw[0]! - rwCalc) / rwCalc).toBeLessThan(1e-3); // redondeo de 4 decimales
    expect(rw[2]!).toBeLessThan(rw[0]!); // más caliente, menos resistivo
    expect(rw[4]!).toBeGreaterThan(rw[0]!);
    // y a otra temperatura coincide con la calculadora con la misma salinidad
    expect(Math.abs(rw[2]! - naclResistivityC(20_000, 100)) / rw[2]!).toBeLessThan(2e-3);
  });
});

describe('integración con la app', () => {
  it('el dock descubre la pestaña «Agua de formación» sin tocar la app', async () => {
    const mod = await import('../src/modules/formation-water/dock');
    const panels = collectDockPanels({ 'formation-water/dock.tsx': mod }, []);
    expect(panels).toHaveLength(1);
    expect(panels[0]).toMatchObject({ id: 'formation-water', title: 'Agua de formación', icon: 'droplet' });
  });

  it('la documentación para Ecuaciones trae ecuaciones y referencias', () => {
    expect(FORMATION_WATER_DOCS.equations.length).toBeGreaterThanOrEqual(3);
    expect(FORMATION_WATER_DOCS.references.join(' ')).toMatch(/Bateman/);
    expect(FORMATION_WATER_DOCS.references.join(' ')).toMatch(/Arps/);
  });
});
