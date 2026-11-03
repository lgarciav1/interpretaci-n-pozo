/**
 * Acciones de la mesa (docs/decisiones/0063): cargar imagen, geometría, trazado en el worker, sesión, importar y
 * exportar. Unen el store de la mesa, el cliente del worker y el proyecto. Sin React.
 */
import {
  estimateTiltAngle,
  fingerprintImage,
  mapPoint,
  sessionMatchesImage,
  type GeometryStep,
  type PixelPoint,
  type RasterImage,
} from '../../digitizer';
import { addWell, makeId, setActiveWell, updateWell } from '../../core/state/project';
import { addTrack, selectorKey, uniqueTrackId, updateTrackLayout } from '../../core/state/tracks';
import type { TrackSpec } from '../../core/display';
import { useUi } from '../../app/store/ui';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { safeFileName } from '../../io/export/files';
import { writeCsv } from '../../io/export/csv';
import { writeLas } from '../../io/export/las';
import { toast } from '../../ui';
import { calibrationOf, specOf, updateCurve, type CurveDraft } from './model/form';
import { addCurvesToWell, exportInputFor, importPlan, newWellFrom, seriesOf, type ImportItem } from './model/outputs';
import { base64ToBytes, buildSessionFile, bytesToBase64, formatBytes, parseSessionFile, restoreWork, serializeSessionFile, SESSION_WARN_BYTES } from './model/sessionFile';
import { initialDigitizerState, useDigitizer, workImageKey, type AddedCurves } from './store';
import { digitizerClient } from './worker/instance';
import { isAbort } from './worker/client';

const S = () => useDigitizer.getState();
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Píxeles máximos de una imagen (límite práctico de memoria y de los lienzos del navegador). */
export const MAX_IMAGE_PIXELS = 120_000_000;
export const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';

// ---------------------------------------------------------------------------------------------------------------
// Imagen

export async function decodeImage(blob: Blob): Promise<RasterImage> {
  if (blob.type && !/^image\/(png|jpeg|webp)$/.test(blob.type)) {
    throw new Error(blob.type === 'application/pdf' ? 'Los PDF no se leen: exportá la página como PNG o JPG.' : blob.type === 'image/tiff' ? 'Los TIFF no se leen: convertí la imagen a PNG o JPG.' : `El formato ${blob.type} no es una imagen JPG, PNG ni WebP.`);
  }
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  } catch {
    throw new Error('No se pudo leer la imagen. ¿Es un JPG, PNG o WebP válido?');
  }
  const { width, height } = bmp;
  if (width * height > MAX_IMAGE_PIXELS) {
    bmp.close();
    throw new Error(`La imagen tiene ${(width * height / 1e6).toFixed(0)} Mpx; el máximo es ${MAX_IMAGE_PIXELS / 1e6} Mpx. Reducila o recortala.`);
  }
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('El navegador no permite leer los píxeles de la imagen.');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const data = ctx.getImageData(0, 0, width, height).data;
  return { width, height, data };
}

/** Carga una imagen nueva (archivo, arrastre o portapapeles). Descarta la sesión anterior. */
export async function loadImage(blob: Blob, name: string): Promise<boolean> {
  S().set({ job: { label: 'Leyendo la imagen…', progress: null, cancellable: false } });
  try {
    const original = await decodeImage(blob);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    digitizerClient.dropImage('corrected');
    digitizerClient.putImage('original', original);
    const st = S();
    st.reset(true);
    st.set({
      image: { name, mime: blob.type || 'image/png', bytes, original, fingerprint: fingerprintImage(original) },
      corrected: original,
      step: 'geometry',
      view: 'original',
      tool: 'tilt',
      fitSeq: st.fitSeq + 1,
    });
    toast({ title: 'Imagen cargada', description: `${name} · ${original.width} × ${original.height} px`, tone: 'ok' });
    return true;
  } catch (e) {
    S().set({ job: null });
    toast({ title: 'No se pudo cargar la imagen', description: errText(e), tone: 'error' });
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Geometría

function quadSize(q: readonly PixelPoint[]): { w: number; h: number } {
  const d = (a: PixelPoint, b: PixelPoint) => Math.hypot(a.x - b.x, a.y - b.y);
  return { w: Math.max(2, Math.round((d(q[0]!, q[1]!) + d(q[3]!, q[2]!)) / 2)), h: Math.max(2, Math.round((d(q[0]!, q[3]!) + d(q[1]!, q[2]!)) / 2)) };
}

/** Pasos de geometría a partir de los puntos marcados (inclinación y, si hay, perspectiva). */
export function geometryStepsFrom(tilt: readonly PixelPoint[], quad: readonly PixelPoint[], rotateForward?: (p: PixelPoint) => PixelPoint): GeometryStep[] {
  const steps: GeometryStep[] = [];
  if (tilt.length === 2) steps.push({ kind: 'rotate', angleRad: estimateTiltAngle(tilt[0]!, tilt[1]!), expand: true });
  if (quad.length === 4) {
    const q = quad.map((p) => (rotateForward ? rotateForward(p) : p)) as [PixelPoint, PixelPoint, PixelPoint, PixelPoint];
    const { w, h } = quadSize(q);
    steps.push({ kind: 'perspective', quad: q, outWidth: w, outHeight: h });
  }
  return steps;
}

async function runGeometry(steps: GeometryStep[]): Promise<void> {
  const st = S();
  if (!st.image) return;
  if (steps.length === 0) {
    digitizerClient.dropImage('corrected');
    st.set({ geometry: [], corrected: st.image.original, forward: null, mask: null });
    return;
  }
  st.set({ job: { label: 'Corrigiendo la imagen…', progress: 0, cancellable: true } });
  const onProgress = (f: number) => S().set({ job: { label: 'Corrigiendo la imagen…', progress: f, cancellable: true } });
  try {
    let all = steps;
    if (steps.length === 2 && steps[0]!.kind === 'rotate') {
      // La perspectiva se marcó sobre la original: sus esquinas se llevan a la imagen ya rotada.
      const rot = await digitizerClient.geometry('original', [steps[0]!], 'corrected', (f) => onProgress(f * 0.5));
      all = geometryStepsFrom(S().picks.tilt, S().picks.quad, (p) => mapPoint(rot.forward, p));
    }
    const r = await digitizerClient.geometry('original', all, 'corrected', all === steps ? onProgress : (f) => onProgress(0.5 + f * 0.5));
    S().set({ geometry: all, corrected: r.image, forward: r.forward, geometrySkipped: false, job: null, mask: null, view: 'corrected', fitSeq: S().fitSeq + 1 });
    toast({ title: 'Imagen corregida', description: `${r.image.width} × ${r.image.height} px`, tone: 'ok' });
  } catch (e) {
    S().set({ job: null });
    if (!isAbort(e)) toast({ title: 'No se pudo corregir la imagen', description: errText(e), tone: 'error' });
  }
}

/** true si ya hay amarres o curvas marcados sobre la imagen corregida (cambiar la geometría los invalida). */
export const hasDownstreamWork = (): boolean => S().work.ties.length > 0 || S().work.curves.length > 0;

/** Aplica la geometría marcada. Borra amarres y curvas (sus coordenadas eran de la imagen anterior). */
export async function applyGeometryPicks(): Promise<void> {
  const { picks } = S();
  let steps: GeometryStep[];
  try {
    steps = geometryStepsFrom(picks.tilt, picks.quad);
  } catch (e) {
    toast({ title: 'No se puede corregir', description: errText(e), tone: 'error' });
    return;
  }
  if (steps.length === 0) {
    toast({ title: 'Nada que corregir', description: 'Marcá 2 puntos sobre una línea vertical o las 4 esquinas.', tone: 'warn' });
    return;
  }
  clearDownstream();
  await runGeometry(steps);
}

export function clearDownstream(): void {
  if (!hasDownstreamWork()) return;
  S().set({ work: { ...S().work, ties: [], curves: [] }, past: [], future: [], selectedCurveId: null, suggestions: {} });
}

export async function resetGeometry(): Promise<void> {
  clearDownstream();
  S().set({ picks: { tilt: [], quad: [] }, geometrySkipped: false });
  await runGeometry([]);
}

export function skipGeometry(): void {
  const st = S();
  if (st.geometry.length) void resetGeometry();
  st.set({ geometrySkipped: true, step: 'depth', tool: 'tie', view: 'corrected' });
}

// ---------------------------------------------------------------------------------------------------------------
// Curvas

export function cancelJob(): void {
  digitizerClient.cancel();
  S().set({ job: null });
}

/** Traza una curva en el worker (automático o guiado). Reemplaza la traza anterior (se puede deshacer). */
export async function traceCurve(id: string): Promise<boolean> {
  const st = S();
  const c = st.work.curves.find((k) => k.id === id);
  const cal = calibrationOf(st.work).calibration;
  if (!c || !st.corrected) return false;
  if (!cal) {
    toast({ title: 'Falta la calibración de profundidad', description: 'Marcá al menos 2 amarres en el paso Profundidad.', tone: 'warn' });
    return false;
  }
  const { spec, problems } = specOf(c, st.corrected);
  if (!spec) {
    toast({ title: `No se puede trazar ${c.mnemonic}`, description: problems[0], tone: 'warn' });
    return false;
  }
  const label = `Trazando ${c.mnemonic}…`;
  st.set({ job: { label, progress: 0, cancellable: true } });
  try {
    const r = await digitizerClient.digitize(workImageKey(st), cal, spec, (f) => S().set({ job: { label, progress: f, cancellable: true } }));
    S().updateWork((w) => updateCurve(w, id, { trace: r.trace, warnings: r.trace.warnings }));
    S().set({ job: null, reviewed: false });
    return true;
  } catch (e) {
    S().set({ job: null });
    if (isAbort(e)) toast({ title: 'Trazado cancelado', tone: 'neutral' });
    else toast({ title: `No se pudo trazar ${c.mnemonic}`, description: errText(e), tone: 'error' });
    return false;
  }
}

/** Colores dominantes de la pista (o de toda la imagen). */
export async function suggestColors(c: CurveDraft): Promise<void> {
  const st = S();
  if (!st.corrected) return;
  const region = (() => {
    const { spec } = specOf({ ...c, color: c.color ?? { mode: 'dark' } }, st.corrected!);
    return spec?.region;
  })();
  try {
    const sug = await digitizerClient.suggest(workImageKey(st), region);
    S().set({ suggestions: { ...S().suggestions, [c.id]: sug } });
    if (sug.colors.length === 0) toast({ title: 'No se encontraron trazos de color', description: 'Usá el cuentagotas sobre la curva o el modo negro sobre claro.', tone: 'warn' });
  } catch (e) {
    toast({ title: 'No se pudieron sugerir colores', description: errText(e), tone: 'error' });
  }
}

/** Máscara de color de una curva (vista rápida «máscara»). */
export async function showMask(c: CurveDraft): Promise<void> {
  const st = S();
  if (!st.corrected || !c.color) {
    toast({ title: 'Elegí primero el color de la curva', tone: 'warn' });
    return;
  }
  const { spec } = specOf(c, st.corrected);
  const region = spec?.region ?? { x0: 0, y0: 0, x1: st.corrected.width, y1: st.corrected.height };
  st.set({ job: { label: 'Calculando la máscara…', progress: 0, cancellable: true } });
  try {
    const mask = await digitizerClient.mask(workImageKey(st), region, c.color, (f) => S().set({ job: { label: 'Calculando la máscara…', progress: f, cancellable: true } }));
    S().set({ mask: { curveId: c.id, mask }, view: 'mask', job: null });
  } catch (e) {
    S().set({ job: null });
    if (!isAbort(e)) toast({ title: 'No se pudo calcular la máscara', description: errText(e), tone: 'error' });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Sesión

function download(bytes: Uint8Array | string, name: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function sessionFileText(savedAt?: string): string | null {
  const st = S();
  if (!st.image || !st.corrected) return null;
  const file = buildSessionFile({
    name: st.image.name.replace(/\.[^.]+$/, ''),
    imageName: st.image.name,
    imageSize: { width: st.image.original.width, height: st.image.original.height },
    fingerprint: st.image.fingerprint,
    geometry: st.geometry,
    geometrySkipped: st.geometrySkipped,
    work: st.work,
    corrected: st.corrected,
    image: { mime: st.image.mime, base64: bytesToBase64(st.image.bytes) },
    ...(savedAt ? { savedAt } : {}),
  });
  return serializeSessionFile(file);
}

export function saveSession(): void {
  const st = S();
  const text = sessionFileText();
  if (!text || !st.image) {
    toast({ title: 'No hay sesión para guardar', description: 'Cargá una imagen primero.', tone: 'warn' });
    return;
  }
  const name = `${safeFileName(st.image.name.replace(/\.[^.]+$/, ''), 'registro')}.digitalizacion.json`;
  download(text, name, 'application/json');
  const size = text.length;
  toast({
    title: 'Sesión guardada',
    description: `${name} · ${formatBytes(size)}${size > SESSION_WARN_BYTES ? ' (la imagen va incrustada: el archivo es grande)' : ''}`,
    tone: size > SESSION_WARN_BYTES ? 'warn' : 'ok',
  });
}

export async function openSession(file: Blob): Promise<boolean> {
  S().set({ job: { label: 'Abriendo la sesión…', progress: null, cancellable: false } });
  try {
    const f = parseSessionFile(await file.text());
    const bytes = base64ToBytes(f.image.base64);
    const original = await decodeImage(new Blob([bytes as BlobPart], { type: f.image.mime }));
    if (!sessionMatchesImage(f.session, original)) {
      throw new Error('la imagen incrustada no coincide con la guardada en la sesión (huella distinta). El archivo puede estar dañado.');
    }
    digitizerClient.dropImage('corrected');
    digitizerClient.putImage('original', original);
    const work = restoreWork(f);
    const st = S();
    st.set({
      ...initialDigitizerState(),
      open: true,
      image: { name: f.session.image.name, mime: f.image.mime, bytes, original, fingerprint: f.session.image.fingerprint },
      corrected: original,
      work,
      geometrySkipped: f.extras.geometrySkipped,
      selectedCurveId: work.curves[0]?.id ?? null,
      step: work.curves.some((c) => c.trace) ? 'review' : work.ties.length ? 'curves' : 'depth',
      fitSeq: st.fitSeq + 1,
    });
    if (f.session.geometry.length) {
      S().set({ job: { label: 'Corrigiendo la imagen…', progress: 0, cancellable: false } });
      const r = await digitizerClient.geometry('original', f.session.geometry, 'corrected', (p) => S().set({ job: { label: 'Corrigiendo la imagen…', progress: p, cancellable: false } }));
      S().set({ geometry: f.session.geometry, corrected: r.image, forward: r.forward });
    }
    S().set({ job: null, fitSeq: S().fitSeq + 1 });
    toast({ title: 'Sesión abierta', description: `${f.session.image.name} · ${work.curves.length} curvas`, tone: 'ok' });
    return true;
  } catch (e) {
    S().set({ job: null });
    toast({ title: 'No se pudo abrir la sesión', description: errText(e).replace(/^No se pudo abrir la sesión: /, ''), tone: 'error' });
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Importar y exportar

function collect(wellForPlan: Parameters<typeof importPlan>[1]): { items: ImportItem[]; names: string[]; scales: AddedCurves['curves'][number]['scale'][] } {
  const st = S();
  const cal = calibrationOf(st.work).calibration;
  const items: ImportItem[] = [];
  const names: string[] = [];
  const scales: AddedCurves['curves'][number]['scale'][] = [];
  for (const c of st.work.curves) {
    if (!c.include) continue;
    const series = seriesOf(c, cal);
    if (!series || series.depthM.length === 0) continue;
    const plan = importPlan(c, wellForPlan, st.importChoices[c.id]);
    items.push({ series, meta: plan.meta });
    names.push(plan.meta.mnemonic);
    // Escala impresa del registro: el valor del borde izquierdo y del derecho (el mayor a la izquierda = invertida).
    scales.push({ kind: c.scaleKind, min: Math.min(c.leftValue, c.rightValue), max: Math.max(c.leftValue, c.rightValue), reversed: c.leftValue > c.rightValue });
  }
  return { items, names, scales };
}

export function addToActiveWell(): boolean {
  const entry = selectActiveEntry(useProject.getState());
  if (!entry) {
    toast({ title: 'No hay pozo activo', description: 'Elegí «Crear pozo nuevo» o cargá un pozo.', tone: 'warn' });
    return false;
  }
  const { items, names, scales } = collect(entry.well);
  if (!items.length) {
    toast({ title: 'No hay curvas para agregar', description: 'Trazá al menos una curva y dejala marcada.', tone: 'warn' });
    return false;
  }
  let result;
  try {
    result = addCurvesToWell(entry.well, items);
  } catch (e) {
    toast({ title: 'No se pudieron agregar las curvas', description: errText(e), tone: 'error' });
    return false;
  }
  const wellId = entry.well.id;
  const label = names.length === 1 ? `Agregar ${names[0]} digitalizada` : `Agregar ${names.length} curvas digitalizadas`;
  useProject.getState().commit(label, (p) => updateWell(p, wellId, (w) => addCurvesToWell(w, items).well));
  S().set({
    delivered: true,
    lastAdded: { wellId, shown: false, curves: result.added.map((a, i) => ({ curveId: a.curve.id, mnemonic: a.curve.mnemonic, scale: scales[i]! })) },
  });
  const cov = result.added.map((a) => `${a.curve.mnemonic} ${Math.round(a.coverage * 100)} %`).join(' · ');
  toast({ title: label.replace(/^Agregar/, 'Se agregó'), description: `${entry.well.name}: cobertura del pozo ${cov}. Ctrl+Z en la app lo deshace.`, tone: 'ok' });
  return true;
}

export function createNewWell(): boolean {
  const st = S();
  const { items } = collect(null);
  if (!items.length) {
    toast({ title: 'No hay curvas para el pozo nuevo', description: 'Trazá al menos una curva y dejala marcada.', tone: 'warn' });
    return false;
  }
  const name = st.newWell.name.trim() || 'Pozo digitalizado';
  let well;
  try {
    well = newWellFrom(items, { id: makeId('dig'), name, step: st.newWell.step, unit: st.newWell.unit, ...(st.image ? { imageName: st.image.name } : {}) });
  } catch (e) {
    toast({ title: 'No se pudo crear el pozo', description: errText(e), tone: 'error' });
    return false;
  }
  useProject.getState().commit(`Crear ${name} digitalizado`, (p) => setActiveWell(addWell(p, well), well.id));
  S().set({ delivered: true });
  toast({ title: 'Pozo creado', description: `${name}: ${well.curves.length} curvas, ${well.depth.values.length.toLocaleString('es-AR')} muestras.`, tone: 'ok' });
  return true;
}

export function exportCurves(format: 'las' | 'csv'): boolean {
  const st = S();
  const { items } = collect(null);
  if (!items.length) {
    toast({ title: 'No hay curvas para exportar', tone: 'warn' });
    return false;
  }
  try {
    const wellName = (st.image?.name ?? 'registro').replace(/\.[^.]+$/, '');
    const input = exportInputFor(items, { wellName, step: st.exportStep.step, unit: st.exportStep.unit });
    const text = format === 'las' ? writeLas(input) : writeCsv(input);
    const name = `${safeFileName(wellName, 'registro')}_digitalizado.${format}`;
    download(text, name, format === 'las' ? 'text/plain;charset=utf-8' : 'text/csv;charset=utf-8');
    S().set({ delivered: true });
    toast({ title: format === 'las' ? 'LAS exportado' : 'CSV exportado', description: `${name} · ${input.depth.length.toLocaleString('es-AR')} muestras`, tone: 'ok' });
    return true;
  } catch (e) {
    toast({ title: 'No se pudo exportar', description: errText(e), tone: 'error' });
    return false;
  }
}

/**
 * Muestra en el visor las curvas que la mesa acaba de agregar al pozo: una pista propia por curva, con la escala
 * impresa del registro, a la derecha de la columna de profundidad. Las que entraron sin rol (el pozo ya tenía esa
 * curva) no están en las pistas de fábrica, que se arman por rol. Un solo paso de deshacer; si la curva ya está en
 * alguna pista, no la duplica.
 */
export async function showAddedInViewer(): Promise<boolean> {
  const added = S().lastAdded;
  const entry = selectActiveEntry(useProject.getState());
  if (!added || !entry || entry.well.id !== added.wellId) {
    toast({ title: 'No hay curvas para mostrar', description: 'Agregá primero las curvas al pozo activo.', tone: 'warn' });
    return false;
  }
  const present = added.curves.filter((a) => entry.well.curves.some((c) => c.id === a.curveId));
  if (!present.length) {
    toast({ title: 'Las curvas ya no están en el pozo', description: 'Se deshizo el agregado: volvé a agregarlas.', tone: 'warn' });
    return false;
  }
  // Carga diferida: la lista de superposiciones del visor importa los módulos (entre ellos, este).
  const [{ OVERLAYS }, { materializedLayout }] = await Promise.all([import('../../app/shell/viewerOverlayList'), import('../../app/tracks/actions')]);
  const workspace = useUi.getState().workspace;
  const label = present.length === 1 ? `Mostrar ${present[0]!.mnemonic} en el visor` : `Mostrar ${present.length} curvas digitalizadas en el visor`;
  let created = 0;
  useProject.getState().commit(label, (p) =>
    updateTrackLayout(p, workspace, materializedLayout(p, workspace, OVERLAYS), (tracks) => {
      let next: readonly TrackSpec[] = tracks;
      // Junto a la columna de profundidad (a su derecha): el visor es angosto y al final de la lista quedaría fuera de
      // la vista. Sin columna de profundidad, al principio.
      const depthAt = tracks.findIndex((t) => t.kind === 'depth');
      const beforeId = tracks[depthAt + 1]?.id ?? null;
      for (const a of present) {
        const key = selectorKey({ curveId: a.curveId });
        if (next.some((t) => t.curves?.some((e) => selectorKey(e.select) === key))) continue;
        const track: TrackSpec = { id: uniqueTrackId(next, a.mnemonic), title: a.mnemonic, kind: 'curves', curves: [{ select: { curveId: a.curveId } }], scale: a.scale };
        next = addTrack(next, track, beforeId);
        created++;
      }
      return next;
    }),
  );
  S().set({ lastAdded: { ...added, shown: true } });
  toast(
    created
      ? { title: created === 1 ? `Pista ${present[0]!.mnemonic} creada` : `${created} pistas creadas`, description: 'Está junto a la columna de profundidad. Ctrl+Z en la app lo deshace.', tone: 'ok' }
      : { title: 'Ya estaban en el visor', tone: 'neutral' },
  );
  return true;
}
