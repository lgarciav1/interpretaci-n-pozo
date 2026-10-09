/**
 * Juego de pistas por espacio de trabajo (semilla para el visor de la fase 4): qué roles van en cada pista.
 * La pista de profundidad se marca con `depth: true`. Roles que el pozo no tiene se omiten.
 */
import type { WorkspaceId } from '../../core/workspaces';

export interface TrackTemplate {
  id: string;
  title: string;
  roles?: readonly string[];
  depth?: boolean;
  /** Ancho relativo. */
  flex?: number;
}

export const TRACK_TEMPLATES: Readonly<Record<WorkspaceId, readonly TrackTemplate[]>> = {
  petrophysics: [
    { id: 'correlation', title: 'Correlación', roles: ['GR', 'SP', 'CALI', 'BS'] },
    { id: 'depth', title: 'Prof.', depth: true, flex: 0.45 },
    { id: 'resistivity', title: 'Resistividad', roles: ['RT', 'RM', 'RS', 'RXO'] },
    { id: 'porosity', title: 'Densidad · neutrón', roles: ['RHOB', 'NPHI', 'PEF', 'DRHO'] },
    { id: 'sonic', title: 'Sónico', roles: ['DT', 'DTS'], flex: 0.8 },
    { id: 'computed', title: 'Interpretación', roles: ['IGR', 'VSH', 'PHIE', 'SW', 'PERM'] },
  ],
  geology: [
    { id: 'spectral', title: 'GR espectral', roles: ['GR', 'CGR', 'POTA', 'THOR', 'URAN'] },
    { id: 'depth', title: 'Prof.', depth: true, flex: 0.45 },
    { id: 'lithology', title: 'Litología', roles: ['RHOB', 'NPHI', 'PEF'] },
    { id: 'sonic', title: 'Sónico', roles: ['DT', 'DTS'], flex: 0.8 },
    { id: 'nmr', title: 'RMN', roles: ['PHIT_NMR', 'PHIE_NMR', 'BVI_NMR'] },
  ],
};
