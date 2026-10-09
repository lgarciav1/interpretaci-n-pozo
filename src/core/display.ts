/**
 * Configuración de visualización que se GUARDA en el proyecto (docs/decisiones/0005-visor-multipista.md, D3):
 * pistas propias por espacio de trabajo y overrides de escala/color por rol o por curva.
 *
 * Es JSON puro (sin typed arrays) y vive fuera de `Interpretation`: cambiarla no recalcula el motor ni entra en
 * los snapshots. Las plantillas de fábrica están en `src/viewer/templates.ts` (el núcleo no importa del visor).
 */
import type { RoleId } from './roles';
import type { DimensionId } from './units';

export type ScaleKind = 'linear' | 'log';
export type LineStyleId = 'solid' | 'dashed' | 'dotted' | 'dashdot';

/** Cambios de dibujo de una curva. Todo opcional; rango en la unidad canónica del rol. */
export interface CurveDisplayOverride {
  scale?: ScaleKind;
  min?: number;
  max?: number;
  reversed?: boolean;
  /** Color CSS hex (#rrggbb). Si falta, el de la paleta del tema. */
  color?: string;
  line?: LineStyleId;
  width?: number;
  /** Curva de respaldo: lo que excede el máximo vuelve a entrar corrido un ancho de escala. */
  wrap?: boolean;
  /** Ocultar la curva en el visor. */
  hidden?: boolean;
}

/** Qué curvas toma una entrada de pista. */
export type CurveSelector =
  /** Curvas medidas con ese rol + la salida activa del módulo que produce ese puerto. */
  | { role: RoleId }
  /** Una curva puntual del pozo. */
  | { curveId: string }
  /** Curvas medidas sin rol de esa magnitud (p. ej. AT10/AT30 en ohm·m). */
  | { unassigned: DimensionId };

export interface TrackCurveSpec {
  select: CurveSelector;
  /** Opciones de la plantilla (por debajo de los overrides del usuario). */
  style?: CurveDisplayOverride;
}

/** Ids de relleno de la paleta (`FILL_PALETTE` de src/ui/curves.ts). Se guardan como texto. */
export type FillRef = string;

export type FillSpec =
  /** Entre el borde de la pista (`side`) y la curva. */
  | { kind: 'edge'; curve: RoleId; side: 'left' | 'right'; fill: FillRef; opacity?: number }
  /**
   * Entre dos curvas, comparando su posición EN PANTALLA: `aLeft` donde la curva `a` queda a la izquierda de `b`,
   * `bLeft` donde queda `b` a la izquierda. Densidad–neutrón: a = RHOB, b = NPHI → aLeft = gas, bLeft = arcilla.
   */
  | { kind: 'between'; a: RoleId; b: RoleId; aLeft?: FillRef; bLeft?: FillRef; opacity?: number }
  /** Entre la curva y un valor fijo (línea base): `left` donde la curva queda a la izquierda del valor. */
  | { kind: 'baseline'; curve: RoleId; value: number; left?: FillRef; right?: FillRef; opacity?: number };

export type TrackKind = 'depth' | 'curves' | 'flags';

export interface TrackSpec {
  id: string;
  title: string;
  kind: TrackKind;
  /** Ancho relativo (las de profundidad tienen ancho fijo). */
  width?: number;
  curves?: TrackCurveSpec[];
  fills?: FillSpec[];
  /** Escala de la grilla y de las curvas sin escala propia (curvas sin rol). */
  scale?: { kind: ScaleKind; min: number; max: number };
  /** Toma las curvas calculadas (o banderas) que ninguna otra pista ubicó. */
  collect?: 'computed' | 'flags';
  /** No se muestra si no tiene curvas. */
  hideWhenEmpty?: boolean;
  /** Texto del estado vacío (qué falta para que aparezcan curvas). */
  emptyHint?: string;
}

export interface DisplaySettings {
  /** Pistas propias por espacio de trabajo (ausente = plantilla de fábrica). */
  layouts: Record<string, TrackSpec[]>;
  /** Overrides por rol, para todo el proyecto. */
  roles: Record<RoleId, CurveDisplayOverride>;
  /** Overrides por curva: pozo → id de curva → override. */
  curves: Record<string, Record<string, CurveDisplayOverride>>;
}

export function emptyDisplay(): DisplaySettings {
  return { layouts: {}, roles: {}, curves: {} };
}

/** true si el override no cambia nada (para borrarlo en vez de guardarlo vacío). */
export function isEmptyOverride(o: CurveDisplayOverride | null | undefined): boolean {
  return !o || Object.values(o).every((v) => v === undefined);
}
