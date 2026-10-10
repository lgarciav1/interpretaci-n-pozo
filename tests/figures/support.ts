/** Pozo del TP resuelto como lo ve el visor (plantilla de Petrofísica, sin curvas calculadas), para los tests de figuras. */
import { zlibSync } from 'fflate';
import csvText from '../../datos/pozo_tp_perfiles.csv?raw';
import { emptyInterpretation } from '../../src/core/interpretation';
import { readWellFile } from '../../src/io';
import { registry } from '../../src/modules';
import { crc32 } from '../../src/io/export/figures/png';
import { approximateMeasure } from '../../src/io/export/figures/svg';
import { templateById } from '../../src/io/export/figures/templates';
import type { ViewerFigureContext, ViewerFigureRequest } from '../../src/viewer/figureInput';
import { createQcOverlay } from '../../src/viewer/overlays/qc';
import { createZonesOverlay } from '../../src/viewer/overlays/zones';
import { resolveTracks } from '../../src/viewer/resolve';
import { BUILTIN_LAYOUTS } from '../../src/viewer/templates';

export function tpFigureContext(): ViewerFigureContext {
  const { well, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
  const interpretation = { ...emptyInterpretation(), zones };
  const tracks = resolveTracks(BUILTIN_LAYOUTS.petrophysics, { depth: well.depth.values, curves: well.curves, computed: [], catalog: registry.roles });
  const viewerZones = zones.map((z) => ({ id: z.id, name: z.name, top: z.top, base: z.base, color: z.color }));
  return {
    well,
    tracks,
    depth: well.depth.values,
    data: { wellId: well.id, depth: well.depth.values, zones: viewerZones, selectedZoneId: null, qc: null, well, interpretation, computed: [] },
    overlays: [...createZonesOverlay({}), createQcOverlay()],
    zones: viewerZones,
    summary: null,
    date: new Date(2026, 9, 10),
    measure: approximateMeasure,
  };
}

export function tpRequest(over: Partial<ViewerFigureRequest> = {}): ViewerFigureRequest {
  const template = templateById('profile-full');
  return { template, range: { kind: 'well' }, verticalScale: 1000, widthCm: template.widthCm, marginCm: template.marginCm, trackIds: null, ...over };
}

/** PNG de 1×1 válido (IHDR, IDAT, IEND) armado con nuestro CRC. */
export function tinyPng(): Uint8Array {
  const chunk = (type: string, data: number[]) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
    return out;
  };
  const ihdr = [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0];
  const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', [...zlibSync(Uint8Array.from([0, 255, 0, 0]))]), chunk('IEND', [])];
  return Uint8Array.from(parts.flatMap((p) => [...p]));
}
