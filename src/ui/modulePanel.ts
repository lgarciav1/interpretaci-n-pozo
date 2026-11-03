/**
 * Contrato del panel a medida de un módulo (opcional): `src/modules/<id>/panel.tsx` exporta
 * `export const panel: ModulePanel = { moduleId: '<id>', component: MiPanel }`.
 * La app lo descubre sola (import.meta.glob). Si no hay panel, se genera a partir del esquema de parámetros.
 * Vive en `ui/` porque es React: las definiciones puras de módulo nunca lo importan.
 */
import type { ComponentType } from 'react';
import type { ClientResult } from '../core/engine/client';
import type { AnyModule } from '../core/module';
import type { ParamValue } from '../core/params';
import type { Interpretation } from '../core/interpretation';

export interface ModulePanelProps {
  module: AnyModule;
  interpretation: Interpretation;
  /** Zona en edición (null = global). */
  zoneId: string | null;
  /** Fija un parámetro por su clave local (la app resuelve la clave de almacenamiento y la zona). */
  /** `opts.group`: id del gesto (arrastre de un slider); los cambios con el mismo id forman una sola entrada de deshacer. */
  setParam(key: string, value: ParamValue, opts?: { group?: string }): void;
  result: ClientResult | null;
}

export interface ModulePanel {
  moduleId: string;
  component: ComponentType<ModulePanelProps>;
  /** 'replace' reemplaza los controles generados; 'append' (por defecto) se muestra debajo. */
  mode?: 'replace' | 'append';
}
