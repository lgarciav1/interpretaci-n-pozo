/**
 * Reportes de control de calidad por pozo: derivados de los datos, no se guardan en el proyecto.
 * Se indexan por id de pozo y se invalidan por identidad del objeto `Well` (si cambian las curvas o sus roles,
 * el pozo es otro objeto y el reporte se recalcula).
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import type { Well } from '../../core/well';
import { runQc, type QcReport } from '../../io';
import { registry } from '../../modules';

interface QcEntry {
  well: Well;
  report: QcReport;
}

export const useQc = create<{ entries: Record<string, QcEntry> }>()(() => ({ entries: {} }));

/** QC con el catálogo de roles de la app (incluye los roles que declaran los módulos). */
export function computeQc(well: Well): QcReport {
  return runQc(well, { roles: registry.roles });
}

export function setWellQc(well: Well, report: QcReport): void {
  useQc.setState((s) => ({ entries: { ...s.entries, [well.id]: { well, report } } }));
}

/** El QC lee profundidad y curvas: un pozo que solo cambió sus conjuntos de puntos conserva el reporte. */
const sameQcData = (a: Well, b: Well) => a === b || (a.depth === b.depth && a.curves === b.curves);

/** Reporte vigente del pozo; si falta o es de una versión anterior del pozo, lo calcula sin bloquear el render. */
export function useWellQc(well: Well | null): QcReport | null {
  const entry = useQc((s) => (well ? s.entries[well.id] : undefined));
  const report = entry && well && sameQcData(entry.well, well) ? entry.report : null;
  useEffect(() => {
    if (!well || report) return;
    const t = setTimeout(() => setWellQc(well, computeQc(well)), 0);
    return () => clearTimeout(t);
  }, [well, report]);
  return report;
}
