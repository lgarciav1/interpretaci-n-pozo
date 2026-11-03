/**
 * Los módulos que corren solo por ser fuente por defecto y no tienen consumidores no ensucian el pozo con errores
 * cuando les falta una curva (docs/arquitectura.md, «Pendientes por fase»). Con el pozo real del TP, con y sin DT.
 */
import { describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { Engine, toEngineWell } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import { readWellFile } from '../src/io';
import { registry } from '../src/modules';

function run(without: readonly string[]) {
  const { well, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
  const trimmed = { ...well, curves: well.curves.map((c) => (without.includes(c.role ?? '') ? { ...c, role: null } : c)) };
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(toEngineWell(trimmed));
  return engine.run(emptyInterpretation(zones));
}

describe('faltantes de módulos que nadie consume, con el pozo del TP', () => {
  it('con todas las curvas no hay errores de entrada faltante', () => {
    const r = run([]);
    expect(r.diagnostics.filter((d) => d.level === 'error')).toEqual([]);
  });

  it('sin el sónico (DT) los módulos que lo necesitan y nadie consume informan info, no error', () => {
    const r = run(['DT']);
    expect(r.diagnostics.filter((d) => d.level === 'error')).toEqual([]);
    const missing = r.diagnostics.filter((d) => d.code === 'missing-input');
    expect(missing.every((d) => d.level === 'info')).toBe(true);
    // Porosidad sónica (Wyllie), carbono orgánico (Passey) y sismograma sintético: piden DT.
    for (const id of ['phi-sonic-wyllie', 'passey-toc', 'synthetic-seismogram']) {
      expect(missing).toContainEqual(expect.objectContaining({ moduleId: id, port: 'DT' }));
    }
    // La porosidad total sigue calculándose: la entrada sónica es opcional.
    expect(missing).toContainEqual(expect.objectContaining({ moduleId: 'phit', port: 'PHIS' }));
    expect(r.outputs.some((o) => o.key === 'phit:PHIT')).toBe(true);
  });
});
