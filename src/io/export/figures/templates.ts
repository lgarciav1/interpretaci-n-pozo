/**
 * Plantillas de figuras para el informe. Una plantilla define qué se dibuja (título, encabezado del pozo, leyenda de
 * curvas con unidad y escala, sumario, créditos), el tamaño y los márgenes por defecto. Puro: sin DOM.
 * docs/decisiones/0012-exportacion-de-figuras.md.
 */
import type { Orientation } from './sizing';

export type FigureSubject = 'profile' | 'crossplot';
export type FigureTemplateId = 'profile-full' | 'profile-tracks' | 'crossplot-legend' | 'profile-summary';

export interface FigureParts {
  /** Título y subtítulo (pozo, tramo, escala). */
  title: boolean;
  /** Franja con los datos del encabezado del pozo (yacimiento, compañía, KB…). */
  wellHeader: boolean;
  /** Encabezado de cada pista: título, curvas con unidad y escala. */
  trackHeaders: boolean;
  /** Leyenda de zonas debajo del perfil. */
  zoneLegend: boolean;
  /** Tabla del sumario por zona debajo del perfil. */
  summary: boolean;
  /** Leyenda del gráfico (series, tendencias con ecuación y R², barra de color). */
  legend: boolean;
  /** Pie con créditos: pozo, fecha y escala. */
  credits: boolean;
}

export interface FigureTemplate {
  id: FigureTemplateId;
  label: string;
  description: string;
  subject: FigureSubject;
  /** Ancho de la figura (PNG y SVG), en cm. */
  widthCm: number;
  /** Alto de un gráfico x–y, en cm (el del perfil lo da la escala vertical). */
  heightCm: number;
  /** Margen blanco alrededor, en cm. */
  marginCm: number;
  /** Escala vertical por defecto (1:N) de un perfil. */
  verticalScale: number;
  /** Orientación de la página PDF. */
  orientation: Orientation;
  /** Margen de la página PDF, en mm. */
  pageMarginMm: number;
  /** El usuario elige qué pistas van. */
  pickTracks: boolean;
  parts: FigureParts;
}

const PROFILE_PARTS: FigureParts = { title: true, wellHeader: true, trackHeaders: true, zoneLegend: true, summary: false, legend: false, credits: true };

export const FIGURE_TEMPLATES: readonly FigureTemplate[] = [
  {
    id: 'profile-full',
    label: 'Figura completa del perfil',
    description: 'Todas las pistas con título, encabezado del pozo, curvas con unidad y escala, zonas y créditos.',
    subject: 'profile',
    widthCm: 18,
    heightCm: 0,
    marginCm: 0.6,
    verticalScale: 500,
    orientation: 'portrait',
    pageMarginMm: 12,
    pickTracks: false,
    parts: PROFILE_PARTS,
  },
  {
    id: 'profile-tracks',
    label: 'Solo pistas seleccionadas',
    description: 'Las pistas que elijas, sin el encabezado del pozo: para una figura chica dentro del texto.',
    subject: 'profile',
    widthCm: 12,
    heightCm: 0,
    marginCm: 0.4,
    verticalScale: 200,
    orientation: 'portrait',
    pageMarginMm: 12,
    pickTracks: true,
    parts: { ...PROFILE_PARTS, wellHeader: false, zoneLegend: false },
  },
  {
    id: 'profile-summary',
    label: 'Perfil + sumario por zona',
    description: 'El perfil completo con la tabla del sumario por zona (espesores, promedios y h·φ·Sh) debajo.',
    subject: 'profile',
    widthCm: 18,
    heightCm: 0,
    marginCm: 0.6,
    verticalScale: 1000,
    orientation: 'portrait',
    pageMarginMm: 12,
    pickTracks: false,
    parts: { ...PROFILE_PARTS, summary: true },
  },
  {
    id: 'crossplot-legend',
    label: 'Crossplot con leyenda',
    description: 'Un gráfico x–y con ejes rotulados, leyenda de series, tendencias con ecuación y R² y créditos.',
    subject: 'crossplot',
    widthCm: 14,
    heightCm: 11,
    marginCm: 0.6,
    verticalScale: 0,
    orientation: 'landscape',
    pageMarginMm: 15,
    pickTracks: false,
    parts: { title: true, wellHeader: false, trackHeaders: false, zoneLegend: false, summary: false, legend: true, credits: true },
  },
];

export function templateById(id: FigureTemplateId): FigureTemplate {
  const t = FIGURE_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`Plantilla de figura desconocida: ${id}.`);
  return t;
}

export const templatesFor = (subject: FigureSubject): FigureTemplate[] => FIGURE_TEMPLATES.filter((t) => t.subject === subject);

/** Fecha para los créditos («10/10/2026»). */
export function creditDate(d: Date): string {
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** «Pozo X», sin repetir la palabra si el nombre ya empieza con ella («Pozo sintético…»). */
export function wellLabel(wellName: string): string {
  return /^pozo\b/i.test(wellName.trim()) ? wellName.trim() : `Pozo ${wellName}`;
}

/** Línea de créditos del pie: pozo y fecha. */
export function creditsLine(wellName: string, date: Date): string {
  return `${wellLabel(wellName)} · ${creditDate(date)}`;
}
