/**
 * Tabla mnemónico → rol (y unidad por defecto), con los alias frecuentes de la industria.
 *
 * `suggestRole` es una sugerencia para el asistente de columnas: la usuaria puede cambiarla. Cuando el mnemónico
 * es ambiguo la confianza baja a 'medium'/'low'; si el mnemónico no está en la tabla, o su unidad es de otra
 * dimensión que la del rol, no se sugiere rol.
 */
import { BUILTIN_ROLES, type RoleId } from '../core/roles';
import { getUnit, parseUnit, registerUnitAlias, sameDimension, type UnitId } from '../core/units';

export type Confidence = 'high' | 'medium' | 'low' | 'none';

export interface RoleSuggestion {
  role: RoleId | null;
  /** Unidad sugerida: la del archivo si se reconoce y es compatible; si no, la usual del mnemónico. */
  unit: UnitId | null;
  confidence: Confidence;
}

interface Entry {
  role: RoleId | null;
  unit: UnitId;
  confidence: Exclude<Confidence, 'none'>;
}

/** Grafía extra de "micro" en sónicos que el núcleo no trae. */
registerUnitAlias('μsec/ft', 'us/ft');

const TABLE = new Map<string, Entry>();

function add(role: RoleId | null, unit: UnitId, confidence: Entry['confidence'], aliases: string[]): void {
  for (const a of aliases) if (!TABLE.has(a)) TABLE.set(a, { role, unit, confidence });
}

// Pozo
add('CALI', 'in', 'high', ['CALI', 'CAL', 'HCAL', 'CALIPER', 'CAL1', 'CALS', 'CALX', 'CALA']);
add('BS', 'in', 'high', ['BS', 'BIT', 'BITSIZE', 'BIT_SIZE', 'BSZ']);
add('TEMP', 'degC', 'medium', ['TEMP', 'TEMPERATURE', 'TEMPR', 'TEMP_BH', 'TCDM']);
// Litología
add('GR', 'gAPI', 'high', ['GR', 'GRC', 'GAMMA', 'GAM', 'GR_EDTC']);
add('GR', 'gAPI', 'medium', ['SGR', 'GRAFM']); // gamma ray espectral total / LWD: aproxima al GR
add('CGR', 'gAPI', 'high', ['CGR', 'HCGR', 'ECGR']); // sin uranio
add('SP', 'mV', 'high', ['SP', 'SPONT']);
add('PEF', 'b/e', 'high', ['PEF', 'PE', 'PEFZ', 'PEFL', 'PEFS', 'PEFA']);
add('PEF', 'b/e', 'medium', ['DPEFM']);
// Porosidad medida
add('RHOB', 'g/cm3', 'high', ['RHOB', 'RHOZ', 'ZDEN', 'RHOB_1', 'DENB']);
add('RHOB', 'g/cm3', 'medium', ['DEN', 'DENS', 'DENSITY', 'RHO', 'BDCFM']);
add('DRHO', 'g/cm3', 'high', ['DRHO', 'ZCOR', 'DRH', 'HDRA', 'DRHB']);
add('DRHO', 'g/cm3', 'medium', ['DRHFM']);
add('NPHI', 'v/v', 'high', ['NPHI', 'NPOR', 'TNPH', 'NPHI_LS', 'NPHI_SS', 'NPHI_DOL', 'SNP']);
add('NPHI', 'v/v', 'medium', ['CNL', 'NEU', 'NEUT', 'NEUTRON', 'NPCKLFM']);
add('DT', 'us/ft', 'high', ['DT', 'DTC', 'DTCO', 'DTP', 'DT4P', 'DTCOMP']);
add('DT', 'us/ft', 'medium', ['AC', 'SONIC', 'DELTAT']);
add('DTS', 'us/ft', 'high', ['DTS', 'DTSM', 'DTSH', 'DT4S', 'DTSHEAR']);
// Resistividad. AT90 = Rt, AT60 = Rm (datos/README.md). La inducción de arreglo más somera tiene roles propios (RA10/20/30, fase 8b).
add('RT', 'ohm.m', 'high', ['RT', 'AT90', 'ILD', 'LLD', 'RDEP', 'RILD', 'LLDC', 'RLLD', 'AHT90', 'AF90', 'M2R9', 'RLA5', 'HDRS', 'RT90']);
add('RT', 'ohm.m', 'medium', ['RD', 'RESD', 'RESDEEP', 'RES_DEEP', 'RACELM']);
add('RM', 'ohm.m', 'high', ['RM', 'AT60', 'ILM', 'RILM', 'AHT60', 'AF60', 'M2R6', 'RLA3', 'RMED', 'LLM']);
add('RM', 'ohm.m', 'medium', ['RPCELM', 'RACEHM']);
add('RS', 'ohm.m', 'high', ['RS', 'SFL', 'SFLU', 'RSFL', 'RESS', 'LLS']);
add('RS', 'ohm.m', 'medium', ['RPCEHM']);
add('RXO', 'ohm.m', 'high', ['RXO', 'MSFL', 'RMSFL', 'MCFL', 'RXOZ', 'RXO8', 'MLL', 'PROX']);
add('RA10', 'ohm.m', 'high', ['AT10', 'AHT10', 'AF10', 'M2R1']);
add('RA20', 'ohm.m', 'high', ['AT20', 'AHT20', 'AF20', 'M2R2']);
add('RA30', 'ohm.m', 'high', ['AT30', 'AHT30', 'AF30', 'M2R3']);
// Espectral
add('URAN', 'ppm', 'high', ['URAN', 'UR', 'URANIUM']);
add('THOR', 'ppm', 'high', ['THOR', 'TH', 'THORIUM']);
add('POTA', 'wt%', 'high', ['POTA', 'POTASSIUM', 'POTASIO', 'KPOT']);
// Resonancia magnética
add('PHIT_NMR', 'v/v', 'high', ['PHIT_CMR', 'PHIT_NMR', 'TCMR']);
add('PHIE_NMR', 'v/v', 'high', ['PHIE_CMR', 'PHIE_NMR', 'CMRP_3MS', 'CMRP3MS']);
add('BVI_NMR', 'v/v', 'high', ['PHI_BVI', 'BVI', 'BVI_CMR', 'BVI_NMR']);

/** Normaliza un mnemónico: mayúsculas, sin espacios laterales, separadores a "_" y sin sufijo tipo ":1". */
export function normalizeMnemonic(mnemonic: string): string {
  return mnemonic
    .trim()
    .toUpperCase()
    .replace(/:\d+$/, '')
    .replace(/[\s-]+/g, '_')
    .replace(/_+$/, '');
}

function roleUnit(role: RoleId): UnitId | null {
  return BUILTIN_ROLES.find((r) => r.id === role)?.unit ?? null;
}

/**
 * Interpreta el texto de unidad de un archivo teniendo en cuenta el rol: "F" es grados Fahrenheit en una
 * temperatura (y pies en una profundidad), y "%" en el potasio es porcentaje en peso, no fracción.
 */
export function resolveUnit(unitText: string | undefined, role: RoleId | null): UnitId | null {
  const text = (unitText ?? '').trim();
  if (text === '') return null;
  const key = text.toUpperCase();
  const canonical = role ? roleUnit(role) : null;
  if (role === 'TEMP' && (key === 'F' || key === 'DEGF')) return 'degF';
  if (canonical && getUnit(canonical)?.dimension === 'concentration' && (key === '%' || key === 'PCT' || key === 'PERCENT')) {
    return 'wt%';
  }
  const parsed = parseUnit(text);
  if (parsed === 'unitless' && canonical && canonical !== 'unitless') return null;
  return parsed;
}

/**
 * Sugiere rol y unidad para una columna a partir de su mnemónico y, si se conoce, el texto de unidad del archivo.
 */
export function suggestRole(mnemonic: string, unitText?: string): RoleSuggestion {
  const entry = TABLE.get(normalizeMnemonic(mnemonic));
  if (!entry) {
    return { role: null, unit: resolveUnit(unitText, null), confidence: 'none' };
  }
  const fileUnit = resolveUnit(unitText, entry.role);
  if (fileUnit && !sameDimension(fileUnit, entry.unit)) {
    // La unidad dice que es otra magnitud: el mnemónico se está usando para otra cosa.
    return { role: null, unit: fileUnit, confidence: 'none' };
  }
  return { role: entry.role, unit: fileUnit ?? entry.unit, confidence: entry.confidence };
}
