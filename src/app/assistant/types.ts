/**
 * Tipos compartidos del Asistente v2 (0094): puro, sin React ni stores.
 * Preserva compatibilidad retroactiva estricta con F26 (`AssistantContext` mínimo).
 */
import type { ClientResult } from '../../core/engine/client';
import type { EngineCurve, EngineRunResult } from '../../core/engine/engine';
import type { Interpretation } from '../../core/interpretation';
import type { Registry } from '../../core/registry';
import type { Snapshot } from '../../core/state/project';
import type { Well, Zone as WellZone } from '../../core/well';
import type { CutoffParamKey } from '../../modules/cutoff-sensitivity/surfaceModel';
import type { CrossCheckId } from '../../petro/crossCheck';
import type { SurfacePairId, SweepVariable } from '../../petro/sensitivity';
import type { Command } from '../../ui/commands';
import type { Tone } from '../../ui/components/Feedback';
import type { EquationEntry } from '../ecuaciones/model';

export type NavigationCommand = Pick<Command, 'id' | 'title' | 'group' | 'keywords' | 'run'>;

export type CurveRole =
  | 'CALI'
  | 'BS'
  | 'TEMP'
  | 'GR'
  | 'SP'
  | 'PE'
  | 'PEF'
  | 'RHOB'
  | 'DRHO'
  | 'NPHI'
  | 'DT'
  | 'DTS'
  | 'RT'
  | 'RM'
  | 'RS'
  | 'RXO'
  | 'RA10'
  | 'RA20'
  | 'RA30'
  | 'URAN'
  | 'THOR'
  | 'POTA'
  | 'CGR'
  | 'PHIT_NMR'
  | 'PHIE_NMR'
  | 'BVI_NMR'
  | 'FFI_NMR'
  | 'CBW_NMR'
  | 'SWIRR_NMR'
  | 'DPHI_NMR'
  | 'IND_NMR_DEFICIT'
  | 'IGR'
  | 'VSH'
  | 'PHID'
  | 'PHIN'
  | 'PHIS'
  | 'PHIT'
  | 'PHIE'
  | 'SW'
  | 'SXO'
  | 'MOS'
  | 'SHR'
  | 'MHI'
  | 'SWI'
  | 'BVW'
  | 'SH'
  | 'RW'
  | 'RWA'
  | 'R0'
  | 'DI'
  | 'RHOMAA'
  | 'FZI'
  | 'R35'
  | 'ROCK_TYPE'
  | 'PERM'
  | 'U_GR_FRAC'
  | 'NET_SAND'
  | 'NET_RES'
  | 'NET_PAY'
  | 'IND_WASHOUT';

export type Metric =
  | 'gross'
  | 'netSand'
  | 'netRes'
  | 'netPay'
  | 'ntgPay'
  | 'phiPay'
  | 'swPay'
  | 'vshPay'
  | 'hphiShPay';

export type CompareMetric = Metric | 'ooip' | 'ogip' | 'kPay';

export type FilterOperator = '>' | '>=' | '<' | '<=' | '=' | 'between';

export interface FilterCondition {
  curve: string;
  op: FilterOperator;
  value: number;
  valueMax?: number;
}

export type Intent =
  | { kind: 'profile'; role: CurveRole; zone: string }
  | { kind: 'summary'; metric: Metric; zone?: string }
  | { kind: 'pay'; zone: string }
  | { kind: 'cutoff'; variable: SweepVariable; threshold: number; zone?: string }
  | { kind: 'cutoff-pair'; changes: readonly { variable: SweepVariable; threshold: number }[]; zone?: string }
  | { kind: 'cutoff-stability'; zone?: string; pair?: SurfacePairId }
  | { kind: 'volume'; fluid?: 'oil' | 'gas' | 'both'; zone?: string }
  | { kind: 'compare'; mode: 'rank'; metric: CompareMetric; direction: 'max' | 'min' }
  | { kind: 'compare'; mode: 'pair'; zones: readonly [string, string] }
  | { kind: 'compare'; mode: 'all' }
  | { kind: 'depth'; depth: number; mode: 'readout' | 'why-pay' | 'provenance'; role?: CurveRole }
  | { kind: 'filter-select'; combinator: 'and' | 'or'; conditions: readonly FilterCondition[]; zone?: string }
  | { kind: 'cross-check'; zone?: string; checkId?: CrossCheckId }
  | { kind: 'mdt'; zone?: string; focus?: 'contacts' | 'emw' | 'all' }
  | { kind: 'smlp'; zone?: string }
  | { kind: 'cgr'; zone?: string }
  | { kind: 'movability'; zone?: string }
  | { kind: 'micp'; zone?: string }
  | { kind: 'pay-layers'; zone?: string }
  | { kind: 'uncertainty'; zone?: string; focus?: 'quantiles' | 'tornado' | 'all' }
  | { kind: 'core'; zone?: string }
  | { kind: 'snapshot-diff'; target?: string; vsDefaults?: boolean }
  | { kind: 'graph-diag'; focus: 'missing' | 'preparation'; target?: string }
  | { kind: 'reading'; phase?: 'hydrocarbon' | 'water'; zone?: string }
  | { kind: 'method'; query: string }
  | { kind: 'warnings'; zone?: string }
  | { kind: 'next' }
  | {
      kind: 'followup';
      zone?: string;
      wholeWell?: boolean;
      fluid?: 'oil' | 'gas';
      cutoff?: { variable?: SweepVariable; threshold: number };
    };

export type Action =
  | { kind: 'command'; id: string; label: string }
  | { kind: 'curve'; role: CurveRole; zoneId: string; label: string }
  | { kind: 'equation'; id: string; label: string }
  | { kind: 'depth'; depth: number; top?: number; base?: number; label: string }
  | { kind: 'provenance'; outputKey: string; depth: number; label: string }
  | {
      kind: 'apply-cutoffs';
      zoneId: string | null;
      updates: readonly { key: CutoffParamKey; value: number }[];
      label: string;
    }
  | { kind: 'apply-selection'; mask: Uint8Array; detailLabel: string; top: number; base: number; label: string }
  | { kind: 'save-selection-flag'; mask: Uint8Array; detailLabel: string; defaultName: string; label: string }
  | { kind: 'curtain'; snapshotId: string; label: string }
  | { kind: 'snapshots'; label: string }
  | { kind: 'panel'; panelId: string; label: string }
  | { kind: 'ask'; question: string; label: string };

export interface AssistantTableCell {
  text: string;
  numeric?: boolean;
  tone?: Tone;
}

export interface AssistantTableRow {
  id: string;
  cells: readonly AssistantTableCell[];
  action?: Action;
}

export interface AssistantTable {
  columns: readonly { label: string; numeric?: boolean }[];
  rows: readonly AssistantTableRow[];
  caption?: string;
}

export interface Answer {
  text: string;
  sources: readonly string[];
  actions: readonly Action[];
  table?: AssistantTable;
  copyText?: string;
  intent?: Intent;
}

export type ContextZone = Pick<WellZone, 'id' | 'name' | 'top' | 'base'> &
  Partial<Pick<WellZone, 'kind' | 'color'>>;

export interface AssistantContext {
  zones: readonly ContextZone[];
  result: Pick<EngineRunResult, 'outputs' | 'diagnostics' | 'sources'> | null;
  equations: readonly EquationEntry[];
  commands: readonly NavigationCommand[];
  nextStep?: { id: string; title: string };
  well?: Readonly<Well> | null;
  rawWell?: Readonly<Well> | null;
  interpretation?: Readonly<Interpretation> | null;
  clientResult?: ClientResult | null;
  snapshots?: readonly Snapshot[];
  registry?: Registry;
  previousIntent?: Intent | null;
  traceCurves?: readonly EngineCurve[];
}

export interface DefenseCard {
  id: string;
  severity: 'error' | 'warn' | 'info';
  topic: string;
  question: string;
  summary: string;
  evidence: readonly string[];
  sources: readonly string[];
  actions: readonly Action[];
}

export interface AutocompleteItem {
  id: string;
  text: string;
  category: string;
  hint?: string;
}
