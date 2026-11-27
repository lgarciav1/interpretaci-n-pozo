import { describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { chatContextText, CHAT_CONTEXT_MAX_CHARS } from '../src/app/chatContext/chatContext';
import { buildReportModel, defaultReportOptions, reportHtml } from '../src/app/report/report';
import type { ClientResult } from '../src/core/engine/client';
import { engineContext } from '../src/core/engine/context';
import { Engine, toEngineWell } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import { readWellFile } from '../src/io';
import { MODULES, PANEL_MODULES, registry } from '../src/modules';
import crossCheck, { CROSS_CHECK_ID } from '../src/modules/cross-check';
import { buildCrossCheckReport, CROSS_CHECK_DOCK_ID } from '../src/modules/cross-check/model';
import { tpCoreSet } from '../src/modules/core/tp';
import { tpMicpSet } from '../src/modules/rock-typing/tp';

function runTp(opts: { withMicp?: boolean; withCore?: boolean } = {}) {
  const { well: baseWell, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
  const pointSets = [
    ...baseWell.pointSets,
    ...(opts.withCore ? [tpCoreSet('tp-core')] : []),
    ...(opts.withMicp ? [tpMicpSet('tp-micp')] : []),
  ];
  const well = { ...baseWell, pointSets };
  const interpretation = { ...emptyInterpretation(), zones };
  const engine = new Engine(registry);
  engine.setWell(toEngineWell(well));
  const result: ClientResult = {
    ...engine.run(interpretation),
    context: engineContext(toEngineWell(well), interpretation),
    wellId: well.id,
    seq: 1,
    gen: 1,
    roundTripMs: 0,
    coalesced: 0,
  };
  return { well, interpretation, result, zones };
}

describe('módulo cross-check: registro y contrato de módulo de panel', () => {
  it('está registrado en PANEL_MODULES sin alterar MODULES ni contratos del motor', () => {
    expect(CROSS_CHECK_ID).toBe('cross-check');
    expect(CROSS_CHECK_DOCK_ID).toBe('cross-check');
    expect(PANEL_MODULES).toContain(crossCheck);
    expect(MODULES.some((m) => m.id === CROSS_CHECK_ID)).toBe(false);
    expect(registry.getPanel(CROSS_CHECK_ID)).toBe(crossCheck);
    expect(crossCheck.docs.equations.length).toBeGreaterThanOrEqual(6);
    expect(crossCheck.docs.notes).toMatch(/criterios operativos/i);
  });
});

describe('módulo cross-check: pozo real del TP (zonas A–E)', () => {
  it('resume con claridad los hallazgos reales de A–E, sin ocultar ensayos faltantes', () => {
    const { well, interpretation, result } = runTp({ withCore: true, withMicp: true });
    const report = buildCrossCheckReport(well, interpretation, result, registry);

    expect(report.zones.map((z) => z.zoneName)).toEqual(['A', 'B', 'C', 'D', 'E']);

    // Con las 8 muestras MICP del TP (en reservorio, no en sellos A/C/E), debe informar h_max y marcar sin soporte directo de sello.
    expect(report.sealSamples.length).toBe(8);
    expect(report.seal.status).toBe('warn');
    expect(report.seal.metrics.hasSealSupport).toBe(false);
    expect(report.seal.detail).toMatch(/Sin soporte directo de roca sello/i);
    expect(Number(report.seal.metrics.hMaxM)).toBeGreaterThan(0);
    // Sin FWL confirmado, la columna observada debe acotarse a una sola zona no sello (no cruzar sellos A..E ~813 m).
    expect(Number(report.seal.metrics.observedColumnM)).toBeGreaterThan(0);
    expect(Number(report.seal.metrics.observedColumnM)).toBeLessThan(300);

    // En las zonas reservorio (B y D), el GR espectral del TP está presente (G06) y no hay contacto MDT resuelto por defecto.
    const zB = report.zones.find((z) => z.zoneName === 'B')!;
    const zD = report.zones.find((z) => z.zoneName === 'D')!;
    expect(zB.checks['uranium-gr'].status).not.toBe('unsupported');
    expect(zD.checks['uranium-gr'].status).not.toBe('unsupported');
    expect(zB.checks['mdt-vs-sw'].status).toBe('unsupported');
    expect(zD.checks['mdt-vs-sw'].status).toBe('unsupported');

    // En B y D hay porosidad RMN y plugs de corona para contrastar contra PHIE.
    expect(zB.checks.porosity.status).not.toBe('unsupported');
    expect(zD.checks.porosity.status).not.toBe('unsupported');
    expect(Number(zB.checks.porosity.metrics.nNmr)).toBeGreaterThan(0);
    expect(Number(zD.checks.porosity.metrics.nNmr)).toBeGreaterThan(0);

    // Agua ligada: debe evaluar al menos 2 fuentes (BVW / RMN / SCAL) y citar el cociente CMR/MICP real (~1,9–3,6×, usando PHIE_NMR).
    expect(zB.checks['bound-water'].status).not.toBe('unsupported');
    expect(zD.checks['bound-water'].status).not.toBe('unsupported');
    expect(zB.checks['bound-water'].detail).toMatch(/1,9–3,6×|1,9–3,7×/);
  });

  it('sin MICP cargado marca capacidad de sello como sin soporte en lugar de ocultarlo', () => {
    const { well, interpretation, result } = runTp({ withMicp: false, withCore: false });
    const report = buildCrossCheckReport(well, interpretation, result, registry);
    expect(report.seal.status).toBe('unsupported');
    expect(report.sealSamples).toHaveLength(0);
  });
});

describe('módulo cross-check: integración en Informe HTML y chatContext', () => {
  it('incluye la sección en el Informe y chatContext por defecto y permite desactivarla', () => {
    const { well, interpretation, result } = runTp({ withMicp: true });
    const model = buildReportModel(well, interpretation, result);
    expect(model.crossCheck).toBeDefined();
    expect(model.crossCheck!.zones).toHaveLength(5);

    const htmlOn = reportHtml(model, [], defaultReportOptions());
    expect(htmlOn).toContain('Coherencia cruzada entre herramientas');
    expect(htmlOn).toContain('Capacidad de sello vs. columna');

    const htmlOff = reportHtml(model, [], { ...defaultReportOptions(), includeCrossCheck: false });
    expect(htmlOff).not.toContain('<h2>Coherencia cruzada entre herramientas</h2>');

    const chatOn = chatContextText(model);
    expect(chatOn.length).toBeLessThanOrEqual(CHAT_CONTEXT_MAX_CHARS);
    expect(chatOn.text).toContain('## Coherencia cruzada entre herramientas');
    expect(chatOn.text).not.toContain('undefined');
    expect(chatOn.text).not.toContain('NaN');

    const chatOff = chatContextText(model, { includeCrossCheck: false });
    expect(chatOff.text).not.toContain('## Coherencia cruzada entre herramientas');
  });
});
