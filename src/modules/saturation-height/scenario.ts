import { isJsonValue } from '../../core/interpretation';
import type { CapillaryModel, CapillarySystem } from '../../petro/saturationHeight';

export interface TabularSource {
  kind: 'point-set';
  setId: string;
  sample: string;
}
export interface LabTransfer {
  source: CapillarySystem;
  destination: CapillarySystem;
  maxRelativeUncertainty: number;
  geometry?: { source: { permeabilityMd: number; porosity: number }; destination: { permeabilityMd: number; porosity: number } };
  geometryEvidence: string;
}
export interface ClassModel {
  rockType: number;
  reference: string;
  conditions: string;
  assignment: string;
  /** Cuando el dato procede de laboratorio, la equivalencia de Sw requiere evidencia separada. */
  saturationBasis: string;
  model: Extract<CapillaryModel, { kind: 'brooks-corey' }> | TabularSource;
  basis: { kind: 'reservoir'; drainage: 'primary'; phase: 'oil' | 'gas' } |
    { kind: 'lab'; drainage: 'primary'; phase: 'oil' | 'gas'; wetting: string; nonWetting: string; angleConvention: string; transfer: LabTransfer };
}
export interface HeightScenario {
  version: 1;
  datum: string;
  geometry: { kind: 'vertical-md'; evidence: string; maxMdTvdDriftM: number } | { kind: 'tvd'; curveId: string; evidence: string; direction: 'down' | 'up'; offsetM: number; maxGapM: number };
  domainM: [number, number];
  phase: 'oil' | 'gas';
  compartment: string;
  fwl: { kind: 'mdt' } | { kind: 'external'; depthM: number; reference: string; uncertaintyM: number | null; tolerancePa: number | null; toleranceReference: string | null; acceptEquality: boolean };
  mdt: { waterId: string; hydrocarbonId: string; review: string; pressureBasis: string } | null;
  classification: { method: 'fzi' | 'winland'; bounds: number[] } | null;
  classes: ClassModel[];
}
export const scenarioTemplate: HeightScenario = {
  version: 1,
  datum: '',
  geometry: { kind: 'vertical-md', evidence: '', maxMdTvdDriftM: 0 },
  domainM: [0, 1],
  phase: 'oil',
  compartment: '',
  fwl: { kind: 'external', depthM: 0, reference: '', uncertaintyM: null, tolerancePa: null, toleranceReference: null, acceptEquality: false },
  mdt: null, classification: null, classes: [],
};

export const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export function readHeightScenario(raw: unknown): HeightScenario {
  if (!isJsonValue(raw) || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Se requiere un objeto JSON de escenario.');
  const s = raw as unknown as HeightScenario;
  if (s.version !== 1 || !Array.isArray(s.classes)) throw new Error('Versión de escenario inválida.');
  const g = s.geometry;
  if (!nonempty(s.datum) || !g || !nonempty(g.evidence) || (g.kind === 'vertical-md'
    ? !finite(g.maxMdTvdDriftM) || g.maxMdTvdDriftM < 0
    : g.kind !== 'tvd' || !nonempty(g.curveId) || !['down', 'up'].includes(g.direction) || !finite(g.offsetM) || !finite(g.maxGapM) || g.maxGapM <= 0)) {
    throw new Error('Faltan geometría revisada y datum común. Para TVD indicá curva, signo positivo hacia abajo, desplazamiento y máximo hueco.');
  }
  if (!Array.isArray(s.domainM) || s.domainM.length !== 2 || !s.domainM.every(finite) || s.domainM[1] <= s.domainM[0] ||
      (s.phase !== 'oil' && s.phase !== 'gas') || !nonempty(s.compartment)) throw new Error('Declarar intervalo vertical, par de fluidos y compartimento revisado.');
  if (!s.fwl || (s.fwl.kind !== 'mdt' && (s.fwl.kind !== 'external' || !finite(s.fwl.depthM) ||
    !nonempty(s.fwl.reference) || !(s.fwl.uncertaintyM === null || (finite(s.fwl.uncertaintyM) && s.fwl.uncertaintyM >= 0)) ||
    !(s.fwl.tolerancePa === null || (finite(s.fwl.tolerancePa) && s.fwl.tolerancePa >= 0)) || !(s.fwl.toleranceReference === null || nonempty(s.fwl.toleranceReference)) || typeof s.fwl.acceptEquality !== 'boolean'))) {
    throw new Error('Falta elegir un FWL MDT o documentar una referencia externa en el datum elegido.');
  }
  if (s.mdt !== null && (!s.mdt || ![s.mdt.waterId, s.mdt.hydrocarbonId, s.mdt.review, s.mdt.pressureBasis].every(nonempty))) {
    throw new Error('El par MDT requiere dos tendencias, revisión de pruebas y una base de presión común.');
  }
  if (s.classification !== null && (!s.classification || !['fzi', 'winland'].includes(s.classification.method) ||
    !Array.isArray(s.classification.bounds) || !s.classification.bounds.every(finite))) throw new Error('Clasificación inválida.');
  const seen = new Set<number>();
  for (const c of s.classes) {
    if (!c || !Number.isInteger(c.rockType) || c.rockType < 0 || seen.has(c.rockType) ||
        ![c.reference, c.conditions, c.assignment, c.saturationBasis].every(nonempty) || !c.model ||
        !['brooks-corey', 'point-set'].includes(c.model.kind)) throw new Error('Cada clase necesita un modelo, condiciones, asignación y base de saturación trazables.');
    if (c.model.kind === 'point-set' && ![c.model.setId, c.model.sample].every(nonempty)) throw new Error('Seleccioná conjunto y muestra capilar.');
    const basis = c.basis;
    if (!basis || basis.phase !== s.phase || basis.drainage !== 'primary' || !['reservoir', 'lab'].includes(basis.kind)) {
      throw new Error('Identificá el drenaje primario, el par agua–hidrocarburo de destino y si la presión corresponde a laboratorio o reservorio.');
    }
    if (basis.kind === 'lab' && (![basis.wetting, basis.nonWetting, basis.angleConvention, basis.transfer?.geometryEvidence].every(nonempty) ||
        basis.wetting.trim().toLowerCase() === basis.nonWetting.trim().toLowerCase() || !basis.transfer?.source || !basis.transfer?.destination)) {
      throw new Error('Documentá fases, convención angular y transferencia de laboratorio, incluida compatibilidad geométrica y, para J entre rocas, colapso por clase.');
    }
    seen.add(c.rockType);
  }
  return s;
}
