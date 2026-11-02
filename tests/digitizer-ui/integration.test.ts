/**
 * Integración de la mesa con el proyecto (docs/decisiones/0063): «Agregar al pozo activo» y «Crear pozo nuevo» como
 * un paso de deshacer/rehacer, la curva sobrevive a guardar/abrir el proyecto v7, LAS exportado releído, y el archivo
 * de sesión (aparte del proyecto) con la imagen incrustada.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { axisFromEdgeValues, fingerprintImage, traceCurve as engineTrace, buildMask } from '../../src/digitizer';
import { useProject } from '../../src/app/store/project';
import { syntheticWell } from '../../src/app/demo/syntheticWell';
import { enableProjectInputRevisions } from '../../src/core/state/inputRevisions';
import { activeWellEntry, addWell, createProject } from '../../src/core/state/project';
import { deserializeProject, serializeProject } from '../../src/core/state/serialize';
import { readWellFile } from '../../src/io';
import { writeCsv } from '../../src/io/export/csv';
import { writeLas } from '../../src/io/export/las';
import { registry } from '../../src/modules';
import { addToActiveWell, createNewWell, sessionFileText } from '../../src/modules/digitizer/actions';
import { calibrationOf, emptyWork, newCurveDraft, type CurveDraft, type WorkState } from '../../src/modules/digitizer/model/form';
import { exportInputFor, importPlan, seriesOf } from '../../src/modules/digitizer/model/outputs';
import { base64ToBytes, bytesToBase64, parseSessionFile, restoreWork, SESSION_FORMAT } from '../../src/modules/digitizer/model/sessionFile';
import { initialDigitizerState, useDigitizer } from '../../src/modules/digitizer/store';
import { FIX, grTruth, smallLog } from './fixture';

const D0 = 7700; // la fila 100 de la imagen se amarra a 7700 m (dentro del pozo sintético)

function tracedWork(): WorkState {
  const { image } = smallLog();
  const gr: CurveDraft = {
    ...newCurveDraft('GR', registry.roles),
    leftPx: FIX.LEFT,
    rightPx: FIX.RIGHT,
    color: { mode: 'color', rgb: [30, 140, 60] },
  };
  const mask = buildMask(image, { x0: FIX.LEFT + 4, y0: 0, x1: FIX.RIGHT - 3, y1: FIX.H }, gr.color!);
  return {
    ...emptyWork(),
    ties: [
      { id: 't1', y: 100, depth: D0 },
      { id: 't2', y: 800, depth: D0 + 700 * FIX.DZ },
      { id: 't3', y: 500, depth: null },
    ],
    curves: [{ ...gr, trace: engineTrace(mask) }],
  };
}

function seedDesk(): void {
  const { image } = smallLog();
  useDigitizer.setState({
    ...initialDigitizerState(),
    open: true,
    image: { name: 'registro.png', mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]), original: image, fingerprint: fingerprintImage(image) },
    corrected: image,
    work: tracedWork(),
  });
}

beforeEach(() => {
  const demo = syntheticWell();
  useProject.getState().replace(enableProjectInputRevisions(addWell(createProject('Prueba'), demo.well, demo.zones)));
  seedDesk();
});
afterEach(() => useDigitizer.setState(initialDigitizerState()));

describe('agregar al pozo activo', () => {
  it('un solo paso de deshacer; la curva entra medida, de «Log Digitizer», sin rol (el pozo ya tiene GR) y con sufijo', () => {
    const before = activeWellEntry(useProject.getState().project)!.well;
    expect(addToActiveWell()).toBe(true);
    const st = useProject.getState();
    expect(st.undoLabel).toBe('Agregar GR_DIG digitalizada');
    const well = activeWellEntry(st.project)!.well;
    const c = well.curves.find((k) => k.id === 'GR_DIG')!;
    expect(c).toMatchObject({ mnemonic: 'GR_DIG', role: null, unit: 'gAPI', origin: { kind: 'measured', source: 'Log Digitizer' } });
    expect(c.data.length).toBe(well.depth.values.length);
    // valores contra la verdad dentro del tramo digitalizado, NaN fuera de él
    let n = 0;
    let se = 0;
    for (let i = 0; i < well.depth.values.length; i++) {
      const d = well.depth.values[i]!;
      const v = c.data[i]!;
      if (d < D0 - 5.2 || d > D0 + 40.2) expect(Number.isNaN(v)).toBe(true);
      else if (Number.isFinite(v) && d > D0 + 1 && d < D0 + 34) {
        se += (v - grTruth(FIX.TOP_M + (100 + (d - D0) / FIX.DZ) * FIX.DZ)) ** 2;
        n++;
      }
    }
    expect(n).toBeGreaterThan(150);
    expect(Math.sqrt(se / n)).toBeLessThan(1.5); // < 1 % de 150
    expect(st.undo()).toBe('Agregar GR_DIG digitalizada');
    expect(activeWellEntry(useProject.getState().project)!.well.curves.map((k) => k.id)).toEqual(before.curves.map((k) => k.id));
    expect(useProject.getState().redo()).toBe('Agregar GR_DIG digitalizada');
    expect(activeWellEntry(useProject.getState().project)!.well.curves.some((k) => k.id === 'GR_DIG')).toBe(true);
    expect(useDigitizer.getState().delivered).toBe(true);
  });

  it('conservar el rol si la persona lo pide; dos veces seguidas no repite el id', () => {
    const id = useDigitizer.getState().work.curves[0]!.id;
    useDigitizer.setState({ importChoices: { [id]: { keepRole: true } } });
    addToActiveWell();
    addToActiveWell();
    const curves = activeWellEntry(useProject.getState().project)!.well.curves;
    expect(curves.filter((k) => k.role === 'GR').map((k) => k.id)).toEqual(['GR', 'GR_DIG', 'GR_DIG2']);
  });

  it('la curva agregada sobrevive a guardar y abrir el proyecto v7 (datos, NaN y origen)', async () => {
    addToActiveWell();
    const p = useProject.getState().project;
    const text = await serializeProject(p);
    expect(JSON.parse(text).version).toBe(7);
    const back = await deserializeProject(text);
    const a = activeWellEntry(p)!.well.curves.find((k) => k.id === 'GR_DIG')!;
    const b = activeWellEntry(back)!.well.curves.find((k) => k.id === 'GR_DIG')!;
    expect(b).toMatchObject({ mnemonic: 'GR_DIG', role: null, unit: 'gAPI', origin: { kind: 'measured', source: 'Log Digitizer' } });
    expect(Array.from(b.data, (v) => (Number.isNaN(v) ? null : v))).toEqual(Array.from(a.data, (v) => (Number.isNaN(v) ? null : v)));
  });

  it('sin superposición con el pozo: no cambia el proyecto y avisa', () => {
    useDigitizer.setState({ work: { ...useDigitizer.getState().work, ties: [{ id: 'a', y: 100, depth: 100 }, { id: 'b', y: 800, depth: 135 }] } });
    const before = useProject.getState().project;
    expect(addToActiveWell()).toBe(false);
    expect(useProject.getState().project).toBe(before);
  });
});

describe('crear pozo nuevo', () => {
  it('pozo con índice uniforme, activo, un paso de deshacer', () => {
    useDigitizer.setState({ newWell: { name: 'Pozo escaneado', step: 0.1, unit: 'm' } });
    expect(createNewWell()).toBe(true);
    const st = useProject.getState();
    expect(st.undoLabel).toBe('Crear Pozo escaneado digitalizado');
    const e = activeWellEntry(st.project)!;
    expect(e.well.name).toBe('Pozo escaneado');
    expect(e.well.depth.step).toBeCloseTo(0.1, 9);
    expect(e.well.curves[0]).toMatchObject({ id: 'GR', role: 'GR', origin: { kind: 'measured', source: 'Log Digitizer' } });
    expect(e.well.header['IMG']?.value).toBe('registro.png');
    st.undo();
    expect(useProject.getState().project.wells).toHaveLength(1);
  });
});

describe('exportar', () => {
  it('LAS y CSV se releen con los lectores de la app (paso uniforme, mismos valores)', () => {
    const w = useDigitizer.getState().work;
    const cal = calibrationOf(w).calibration;
    const c = w.curves[0]!;
    const items = [{ series: seriesOf(c, cal)!, meta: importPlan(c, null).meta }];
    const input = exportInputFor(items, { wellName: 'escaneado', step: 0.1524, unit: 'm', generatedAt: new Date('2026-11-02T00:00:00Z') });
    const las = writeLas(input);
    const { well } = readWellFile(las, 'x.las');
    expect(well.depth.step).toBeCloseTo(0.1524, 6);
    const gr = well.curves.find((k) => k.mnemonic === 'GR')!;
    expect(gr.role).toBe('GR');
    for (let i = 10; i < input.depth.length - 10; i += 17) expect(gr.data[i]).toBeCloseTo(input.columns[0]!.data[i]!, 3);
    const csv = readWellFile(writeCsv(input), 'x.csv').well;
    expect(csv.curves.find((k) => k.mnemonic === 'GR')!.data.length).toBe(input.depth.length);
  });

  it('suavizado y picos solo si se piden (apagados por defecto)', () => {
    const w = useDigitizer.getState().work;
    const cal = calibrationOf(w).calibration;
    const c = w.curves[0]!;
    const raw = seriesOf(c, cal)!;
    expect(seriesOf({ ...c }, cal)!.values).toEqual(raw.values);
    const med = seriesOf({ ...c, median: 5 }, cal)!;
    expect(med.values).not.toEqual(raw.values);
    expect(med.depthM.length).toBe(raw.depthM.length);
  });
});

describe('archivo de sesión', () => {
  it('ida y vuelta: imagen incrustada, amarres pendientes, curvas y trazas', () => {
    const text = sessionFileText('2026-11-02T00:00:00.000Z')!;
    const f = parseSessionFile(text);
    expect(f.format).toBe(SESSION_FORMAT);
    expect(Array.from(base64ToBytes(f.image.base64))).toEqual([137, 80, 78, 71, 1, 2, 3]);
    expect(f.session.depth?.ties).toHaveLength(2);
    expect(f.session.curves).toHaveLength(1);
    const work = restoreWork(f);
    const orig = useDigitizer.getState().work;
    expect(work.ties).toEqual(orig.ties);
    expect(work.curves[0]).toMatchObject({ mnemonic: 'GR', role: 'GR', leftPx: FIX.LEFT, rightPx: FIX.RIGHT, color: { mode: 'color', rgb: [30, 140, 60] } });
    const a = Array.from(orig.curves[0]!.trace!.x, (v) => (Number.isNaN(v) ? null : v));
    expect(Array.from(work.curves[0]!.trace!.x, (v) => (Number.isNaN(v) ? null : v))).toEqual(a);
    expect(f.session.image.fingerprint).toBe(fingerprintImage(smallLog().image));
  });

  it('una curva a medio definir viaja en los extras (su trazo también) y se reconstruye', () => {
    const half = { ...newCurveDraft('SP', registry.roles), leftPx: 50 };
    useDigitizer.setState({ work: { ...useDigitizer.getState().work, curves: [...useDigitizer.getState().work.curves, half] } });
    const f = parseSessionFile(sessionFileText()!);
    expect(f.session.curves.map((c) => c.mnemonic)).toEqual(['GR']);
    expect(restoreWork(f).curves.map((c) => c.mnemonic)).toEqual(['GR', 'SP']);
    // sin extras (archivo escrito por otra herramienta): se rearma desde la sesión del motor
    const bare = restoreWork({ ...f, extras: { ...f.extras, curves: [], ties: [] } });
    expect(bare.curves[0]).toMatchObject({ mnemonic: 'GR', leftValue: 0, rightValue: 150 });
    expect(bare.ties.map((t) => t.depth)).toEqual([D0, D0 + 35]);
  });

  it('archivos que no son sesiones o están dañados: mensajes claros', () => {
    expect(() => parseSessionFile('{')).toThrow(/JSON válido/);
    expect(() => parseSessionFile('{"format":"pozo-proyecto"}')).toThrow(/no es una sesión/);
    const f = JSON.parse(sessionFileText()!);
    expect(() => parseSessionFile(JSON.stringify({ ...f, image: { mime: 'image/png', base64: '' } }))).toThrow(/imagen incrustada/);
    f.session.curves[0].frame.rightPx = 0;
    expect(() => parseSessionFile(JSON.stringify(f))).toThrow(/derecha del izquierdo/);
  });

  it('base64 sin dependencias, también con archivos grandes', () => {
    const big = new Uint8Array(300_000).map((_, i) => (i * 31) & 255);
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
  });
});

describe('escala del registro', () => {
  it('la escala invertida de la curva no invalida la traza (está en píxeles)', () => {
    const w = useDigitizer.getState().work;
    const c = w.curves[0]!;
    const cal = calibrationOf(w).calibration;
    const inv = seriesOf({ ...c, leftValue: 150, rightValue: 0 }, cal)!;
    const raw = seriesOf(c, cal)!;
    expect(inv.values[10]! + raw.values[10]!).toBeCloseTo(150, 9);
    expect(axisFromEdgeValues(150, 0, 'linear').reversed).toBe(true);
  });
});
