import { describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { computeOnce, Engine, toEngineWell } from '../src/core/engine/engine';
import { defineModule, input, output } from '../src/core/module';
import { curve, well as syntheticWell } from './helpers';
import { createRegistry } from '../src/core/registry';
import { emptyInterpretation } from '../src/core/interpretation';
import { readWellFile } from '../src/io';
import igr from '../src/modules/igr';
import vsh from '../src/modules/vsh';
import density from '../src/modules/phi-density';
import neutron from '../src/modules/phi-neutron';
import sonic from '../src/modules/phi-sonic-wyllie';
import phit from '../src/modules/phit';
import phie from '../src/modules/phie-vsh';
import archie from '../src/modules/sw-archie';
import simandoux from '../src/modules/sw-simandoux';
import indonesia from '../src/modules/sw-indonesia';
import rw from '../src/modules/rw-manual';
import temperature from '../src/modules/temp-gradient';
import { registry as productionRegistry } from '../src/modules';
import { TP_CORE_PLUGS } from '../src/modules/core/tpData';
import { evaluateTournament, scoreTournament, TOURNAMENT_CANDIDATES, tournamentInterpretation, type TournamentObservation } from '../src/petro/modelTournament';

const candidates = TOURNAMENT_CANDIDATES;
const c = candidates[0]!;
const observations: TournamentObservation[] = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, depth: i, value: 0.2, usage: 'evaluation' }));
const depth = observations.map(o => o.depth);
const prediction = (values: number[], candidate = c) => ({ candidate, phi: Float64Array.from(values) });
const reg = createRegistry([igr, vsh, density, neutron, sonic, phit, phie, archie, simandoux, indonesia, rw, temperature]);

describe('F22 modelo exploratorio', () => {
  it('subgrafo mantiene fuentes y dependencias exactas sin ejecutar consumidores ajenos', () => {
    let downstreamCalls = 0;
    const downstream = defineModule({ id: 'heavy-consumer', name: 'Consumidor costoso', category: 'other', workspace: 'petrophysics',
      inputs: { phi: input.curve('PHIT') }, params: {}, outputs: { k: output.curve('PERM') },
      compute({ n }) { downstreamCalls++; return { k: new Float64Array(n).fill(1) }; }, docs: { summary: 'Prueba', equations: [], references: [] } });
    const scopedReg = createRegistry([...reg.modules, downstream]);
    const w = syntheticWell([curve('d', 'RHOB', depth.map(() => 2.32)), curve('n', 'NPHI', depth.map(() => .2)), curve('g', 'GR', depth.map(() => 50)), curve('r', 'RT', depth.map(() => 10))]);
    for (const explicit of [false, true]) {
      const base = emptyInterpretation();
      if (explicit) base.sources.PHIE = { kind: 'module', moduleId: 'phie-vsh' };
      const choice = tournamentInterpretation(base, c);
      const full = computeOnce(scopedReg, w, choice);
      expect(downstreamCalls).toBe(explicit ? 2 : 1);
      const engine = new Engine(scopedReg, { targetModuleIds: ['vsh', 'phit', c.swModuleId], checkInputs: true });
      engine.setWell(w);
      const partial = engine.run(choice);
      expect(downstreamCalls).toBe(explicit ? 2 : 1);
      expect(partial.sources).toEqual(full.sources);
      for (const o of partial.outputs) expect(o.value).toEqual(full.outputs.find(f => f.key === o.key)!.value);
      expect(partial.nodes.some(n => n.moduleId === 'heavy-consumer')).toBe(false);
      const repeated = engine.run(choice);
      expect(repeated.stats.recomputed).toEqual([]);
      expect(repeated.outputs.map(o => o.key)).toEqual(partial.outputs.map(o => o.key));
    }
  });
  it('75 combinaciones explícitas, sin ganador integral ni entrenamiento disfrazado', () => {
    expect(new Set(candidates.map(c => c.id)).size).toBe(75);
    const r = scoreTournament(depth, [prediction(depth.map(() => .23))], observations);
    expect(r.assessment).toBe('exploratory');
    expect(r.rows[0]!.phi.rmse).toBeCloseTo(.03, 14);
    expect(r.rows[0]!.phi.mae).toBeCloseTo(.03, 14);
    expect(r.rows[0]!.phi.bias).toBeCloseTo(.03, 14);
    expect(r.rows[0]!.commonPhi.supported).toBe(true);
    expect(r.rows[0]!.sw.status).toBe('not-evaluable');
    expect(r.rows[0]!.vsh.status).toBe('not-evaluable');
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
  it('distingue cobertura calculada y bloquea aplicación sin SW/Vsh aunque φ tenga soporte', () => {
    const p = prediction(depth.map(() => .2));
    const missing = scoreTournament(depth, [p], observations).rows[0]!;
    expect(missing.commonPhi.supported).toBe(true);
    expect(missing.applicable).toBe(false);
    expect(missing.calculatedCoverage.sw.n).toBe(0);
    const complete = scoreTournament(depth, [{ ...p, sw: depth.map(() => .4), vsh: depth.map(() => .1) }], observations).rows[0]!;
    expect(complete.applicable).toBe(true);
    expect(complete.sw.status).toBe('not-evaluable');
  });
  it('excluye ajuste y referencias fuera dominio, conserva denominador elegible y no extrapola', () => {
    const refs = observations.map((o, i) => ({ ...o, usage: i < 2 ? 'calibration' as const : 'evaluation' as const }));
    refs.push({ id: 'bad', depth: 3, value: 2, usage: 'evaluation' });
    refs.push({ id: 'outside', depth: 40, value: .2, usage: 'evaluation' });
    const r = scoreTournament(depth, [prediction(depth.map(() => .2))], refs);
    expect(r.calibrationCount).toBe(2);
    expect(r.invalidCount).toBe(1);
    expect(r.evaluationCount).toBe(9);
    expect(r.rows[0]!.phi.n).toBe(8);
    expect(r.rows[0]!.phi.coverage).toBe(8 / 9);
    expect(() => scoreTournament(depth, [], [observations[0]!, observations[0]!])).toThrow(/duplicada/);
  });
  it('no premia perder cobertura: intersección debe cumplir mínimos también', () => {
    const a = depth.map((_, i) => i < 2 ? NaN : .21);
    const b = depth.map((_, i) => i > 7 ? NaN : .2);
    const r = scoreTournament(depth, [prediction(a), prediction(b, candidates[1]!)], observations);
    expect(r.rows.every(r => r.phi.supported)).toBe(true);
    expect(r.commonSupport).toBe(6);
    expect(r.rows.every(r => !r.commonPhi.supported)).toBe(true);
    expect(r.rows.every(r => r.commonPhi.coverage === .6)).toBe(true);
  });
  it('interpolación conocida, sin vecinos nulos ni predicciones fuera dominio', () => {
    const refs = observations.map(o => ({ ...o, depth: o.depth + .5 }));
    const r = scoreTournament(depth, [prediction(depth.map((_, i) => i === 4 ? NaN : .1 + i * .02))], refs);
    expect(r.rows[0]!.phi.n).toBe(7); // último fuera y dos intervalos tocan NaN
    expect(r.rows[0]!.phi.supported).toBe(false);
    const outside = scoreTournament(depth, [prediction(depth.map(() => .6))], observations);
    expect(outside.rows[0]!.phi.rmse).toBeNull();
    const invalidNeighbor = scoreTournament([0, 1], [prediction([.6, .2])], [{ id: 'mid', depth: .5, value: .4, usage: 'evaluation' }]);
    expect(invalidNeighbor.rows[0]!.phi.n).toBe(0);
  });
  it('fuentes explícitas y parámetros por zona: misma interpretación exacta al aplicar', () => {
    const base = emptyInterpretation([{ id: 'z', name: 'Z', top: 0, base: 9, kind: 'formation', color: '#888' }]);
    base.params.zones.z = { 'vsh.method': 'linear', 'phit.method': 'neutron', m: 2.1 };
    base.sources.RHOB = { kind: 'curve', curveId: 'prep:d:rhob' };
    base.disabled = ['phit', 'vsh', 'sw-archie', 'other'];
    const altered = tournamentInterpretation(base, c);
    expect(altered.sources.RHOB).toEqual(base.sources.RHOB);
    expect(altered.params.zones.z!['phit.method']).toBe(c.porosityMethod);
    expect(altered.params.zones.z!.m).toBe(2.1);
    expect(altered.disabled).toEqual(['other']);
    expect(base.params.zones.z!['phit.method']).toBe('neutron');
  });
  it('subgrafo productivo conserva VSH PHIT SW exactos y caché entre candidatos A/B/A', () => {
    const { well, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
    const input = toEngineWell(well);
    const base = emptyInterpretation(zones);
    base.sources.PHIE = { kind: 'module', moduleId: 'phie-shale-corrected' };
    const a = candidates.find(c => c.vshMethod === 'linear' && c.porosityMethod === 'density' && c.swModuleId === 'sw-archie')!;
    const b = candidates.find(c => c.vshMethod === 'steiber' && c.porosityMethod === 'neutron' && c.swModuleId === 'sw-archie')!;
    const engine = new Engine(productionRegistry, { targetModuleIds: ['vsh', 'phit', 'sw-archie'] });
    engine.setWell(input);
    for (const candidate of [a, b, a]) {
      const interp = tournamentInterpretation(base, candidate);
      const full = computeOnce(productionRegistry, input, interp);
      const scoped = engine.run(interp);
      expect(scoped.sources).toEqual(full.sources);
      for (const key of ['vsh:VSH', 'phit:PHIT', 'sw-archie:SW']) {
        expect(scoped.outputs.find(o => o.key === key)?.value).toEqual(full.outputs.find(o => o.key === key)?.value);
      }
      expect(scoped.nodes.some(n => n.moduleId === 'phie-shale-corrected')).toBe(true);
    }
  });
  it('TP real: 151 plugs y candidato reproduce métricas del mismo motor tras seleccionar', () => {
    const { well, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
    const input = toEngineWell(well);
    const interp = emptyInterpretation(zones);
    const refs: TournamentObservation[] = TP_CORE_PLUGS.map(p => ({ id: p.id, depth: p.depthM, value: p.phi, usage: 'evaluation' }));
    const result = evaluateTournament(reg, input, interp, refs);
    expect(result.evaluationCount).toBe(151);
    expect(result.rows).toHaveLength(75);
    expect(result.rows.every(row => row.applicable)).toBe(true);
    expect(result.commonSupport).toBeGreaterThan(120);
    const row = result.rows.find(r => r.candidate.porosityMethod === 'density')!;
    const applied = computeOnce(reg, input, tournamentInterpretation(interp, row.candidate), { checkInputs: true });
    const phi = applied.outputs.find(o => o.moduleId === 'phit' && o.port === 'PHIT')!.value as Float64Array;
    const recalculated = scoreTournament(input.depth, [{ candidate: row.candidate, phi }], refs);
    expect(recalculated.rows[0]!.phi).toEqual(row.phi);
    const independentRmse = { density: .035340344168209754, neutron: .029407095955827404, densityNeutron: .02166717666852223, densityNeutronGas: .02094443501494856, sonic: .03159470075254629 };
    // Revisor independiente: Python desde CSV y plugs JSON, ecuaciones escalares externas al motor.
    for (const row of result.rows) expect(row.phi.rmse).toBeCloseTo(independentRmse[row.candidate.porosityMethod], 13);
  });
});
