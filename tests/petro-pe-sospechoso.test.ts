import { describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { readWellFile } from '../src/io';
import { Engine, toEngineWell } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import { registry } from '../src/modules';
import { detectSuspectPe, forwardMinerals, invertMinerals, type MineralVolumes } from '../src/petro/mineralogy';

describe('Inversión mineral sin PE', () => {
  // Mezclas sin dolomía: con ρb, φN, GR y cierre el sistema queda determinado (4 incógnitas).
  it.each<[string, MineralVolumes]>([
    ['arenisca limpia', [0.8, 0, 0, 0, 0.2]],
    ['arenisca arcillosa', [0.55, 0, 0, 0.3, 0.15]],
    ['caliza con arcilla', [0, 0.75, 0, 0.1, 0.15]],
    ['mezcla de cuatro', [0.4, 0.2, 0, 0.25, 0.15]],
  ])('%s: recupera los volúmenes aunque el PE esté inflado', (_, volumes) => {
    const obs = forwardMinerals(volumes);
    const result = invertMinerals({ ...obs, pe: obs.pe + 4 }, { ignorePe: true });
    expect(result.valid).toBe(true);
    result.volumes.forEach((v, i) => expect(v).toBeCloseTo(volumes[i]!, 6));
    expect(result.volumes[2]).toBe(0);
    expect(Number.isNaN(result.residuals.u)).toBe(true);
  });
  it('un PE ausente no invalida la muestra sin PE, pero sí con PE', () => {
    const obs = { ...forwardMinerals([0.7, 0, 0, 0.1, 0.2]), pe: NaN };
    expect(invertMinerals(obs, { ignorePe: true }).valid).toBe(true);
    expect(invertMinerals(obs).valid).toBe(false);
  });
  it('con PE inflado y PE activo, la misma arenisca sale como calcita (el problema que motiva el modo)', () => {
    const obs = forwardMinerals([0.8, 0, 0, 0, 0.2]);
    const r = invertMinerals({ ...obs, pe: 6 });
    expect(r.volumes[1]).toBeGreaterThan(r.volumes[0]);
  });
});

describe('Detección de PE sospechoso', () => {
  it('arenisca con PE normal no es sospechosa; con PE > 4 sí', () => {
    const rho = [2.35, 2.4, 2.45, 2.3];
    expect(detectSuspectPe([1.9, 2.1, 2.5, 1.8], rho).suspect).toBe(false);
    const r = detectSuspectPe([5.5, 6, 2, 7], rho);
    expect(r.fraction).toBeCloseTo(0.75, 10); expect(r.suspect).toBe(true);
  });
  it('carbonato denso con PE alto no es sospechoso', () => {
    expect(detectSuspectPe([5.1, 5.0, 3.1], [2.68, 2.7, 2.84]).suspect).toBe(false);
  });
  it('ignora NaN; sin muestras válidas no marca', () => {
    expect(detectSuspectPe([NaN, 6], [2.4, NaN])).toMatchObject({ samples: 0, suspect: false });
  });
});

describe('Pozo del TP', () => {
  const { well, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
  const engine = new Engine(registry, { checkInputs: true }); engine.setWell(toEngineWell(well));
  const curve = (r: ReturnType<Engine['run']>, port: string) => r.outputs.find(o => o.port === port)!.value as Float64Array;
  const mean = (a: Float64Array) => { let s = 0, n = 0; for (const v of a) if (Number.isFinite(v)) { s += v; n++; } return s / n; };
  it('el PE es sospechoso (posible baritina) y en automático la inversión no lo usa: domina el cuarzo, no la calcita', () => {
    const r = engine.run(emptyInterpretation(zones));
    expect(r.diagnostics.some(d => d.moduleId === 'mineral-inversion' && /PE sospechoso/.test(d.message))).toBe(true);
    expect(mean(curve(r, 'V_QUARTZ'))).toBeGreaterThan(mean(curve(r, 'V_CALCITE')));
    expect(mean(curve(r, 'V_DOLOMITE'))).toBe(0);
  });
  it('con «Usar siempre» vuelve el resultado con PE (calcita dominante) y el aviso lo dice', () => {
    const r = engine.run({ ...emptyInterpretation(zones), params: { global: { 'mineral-inversion.peMode': 'use' }, zones: {} } });
    expect(mean(curve(r, 'V_CALCITE'))).toBeGreaterThan(mean(curve(r, 'V_QUARTZ')));
    expect(r.diagnostics.some(d => /Usar siempre/.test(d.message))).toBe(true);
  });
});
