/**
 * Parser determinista de intenciones del Asistente v2 (0094): sin LLM, sin red.
 * Incluye normalización de tildes/puntuación, diccionario ampliado de roles/métricas y tolerancia tipográfica
 * acotada únicamente sobre palabras léxicas largas (≥ 4 letras; nunca sobre identificadores cortos 1–3 letras).
 */
import type { CrossCheckId } from '../../petro/crossCheck';
import type { SweepVariable } from '../../petro/sensitivity';
import { fold } from '../../ui/commands';
import type { CompareMetric, CurveRole, FilterCondition, FilterOperator, Intent, Metric } from './types';

export type { CurveRole, Intent, Metric };

export const CURVES: Readonly<Record<string, CurveRole>> = {
  gr: 'GR',
  'rayos gamma': 'GR',
  'gamma ray': 'GR',
  cgr: 'CGR',
  'gr sin uranio': 'CGR',
  'gr espectral': 'CGR',
  rt: 'RT',
  'resistividad profunda': 'RT',
  rm: 'RM',
  'resistividad media': 'RM',
  rs: 'RS',
  'resistividad somera': 'RS',
  rxo: 'RXO',
  'zona lavada': 'RXO',
  ra10: 'RA10',
  ra20: 'RA20',
  ra30: 'RA30',
  sp: 'SP',
  'potencial espontaneo': 'SP',
  cali: 'CALI',
  caliper: 'CALI',
  bs: 'BS',
  'bit size': 'BS',
  trepano: 'BS',
  'diametro de trepano': 'BS',
  rhob: 'RHOB',
  densidad: 'RHOB',
  drho: 'DRHO',
  'correccion de densidad': 'DRHO',
  nphi: 'NPHI',
  neutron: 'NPHI',
  dt: 'DT',
  sonico: 'DT',
  dts: 'DTS',
  pe: 'PEF',
  pef: 'PEF',
  fotoelectrico: 'PEF',
  'factor fotoelectrico': 'PEF',
  temp: 'TEMP',
  temperatura: 'TEMP',
  uran: 'URAN',
  thor: 'THOR',
  torio: 'THOR',
  pota: 'POTA',
  potasio: 'POTA',
  igr: 'IGR',
  vsh: 'VSH',
  arcilla: 'VSH',
  arcillosidad: 'VSH',
  'volumen de arcilla': 'VSH',
  phid: 'PHID',
  phin: 'PHIN',
  phis: 'PHIS',
  phit: 'PHIT',
  'porosidad total': 'PHIT',
  phi: 'PHIE',
  'φ': 'PHIE',
  phie: 'PHIE',
  porosidad: 'PHIE',
  'porosidad efectiva': 'PHIE',
  phit_nmr: 'PHIT_NMR',
  phie_nmr: 'PHIE_NMR',
  bvi_nmr: 'BVI_NMR',
  ffi_nmr: 'FFI_NMR',
  cbw_nmr: 'CBW_NMR',
  swirr_nmr: 'SWIRR_NMR',
  dphi_nmr: 'DPHI_NMR',
  ind_nmr_deficit: 'IND_NMR_DEFICIT',
  sw: 'SW',
  'saturacion de agua': 'SW',
  saturacion: 'SW',
  sh: 'SH',
  'saturacion de hidrocarburos': 'SH',
  sxo: 'SXO',
  mos: 'MOS',
  'hidrocarburo movil': 'MOS',
  shr: 'SHR',
  'hidrocarburo residual': 'SHR',
  mhi: 'MHI',
  'indice de movilidad': 'MHI',
  swi: 'SWI',
  'saturacion irreducible': 'SWI',
  bvw: 'BVW',
  rw: 'RW',
  rwa: 'RWA',
  r0: 'R0',
  di: 'DI',
  fzi: 'FZI',
  r35: 'R35',
  rock_type: 'ROCK_TYPE',
  perm: 'PERM',
  k: 'PERM',
  permeabilidad: 'PERM',
  rhomaa: 'RHOMAA',
  'densidad de matriz': 'RHOMAA',
  u_gr_frac: 'U_GR_FRAC',
  uranio: 'U_GR_FRAC',
  net_sand: 'NET_SAND',
  net_res: 'NET_RES',
  net_pay: 'NET_PAY',
  ind_washout: 'IND_WASHOUT',
  derrumbe: 'IND_WASHOUT',
};

export const METRICS: Readonly<Record<string, Metric>> = {
  bruto: 'gross',
  'espesor bruto': 'gross',
  'arena neta': 'netSand',
  'reservorio neto': 'netRes',
  pay: 'netPay',
  'pay neto': 'netPay',
  'neto pay': 'netPay',
  'espesor de pay': 'netPay',
  'n/g': 'ntgPay',
  'ng': 'ntgPay',
  'n/g de pay': 'ntgPay',
  'net to gross': 'ntgPay',
  'porosidad del pay': 'phiPay',
  'phi del pay': 'phiPay',
  'φ del pay': 'phiPay',
  'sw del pay': 'swPay',
  'vsh del pay': 'vshPay',
  'hphish': 'hphiShPay',
  'h phi sh': 'hphiShPay',
  'h·φ·sh': 'hphiShPay',
  'espesor de hidrocarburo': 'hphiShPay',
};

const COMPARE_METRICS: Readonly<Record<string, { metric: CompareMetric; defaultDir: 'max' | 'min' }>> = {
  pay: { metric: 'netPay', defaultDir: 'max' },
  'pay neto': { metric: 'netPay', defaultDir: 'max' },
  'neto pay': { metric: 'netPay', defaultDir: 'max' },
  'espesor de pay': { metric: 'netPay', defaultDir: 'max' },
  'reservorio neto': { metric: 'netRes', defaultDir: 'max' },
  'arena neta': { metric: 'netSand', defaultDir: 'max' },
  bruto: { metric: 'gross', defaultDir: 'max' },
  'espesor bruto': { metric: 'gross', defaultDir: 'max' },
  'n/g': { metric: 'ntgPay', defaultDir: 'max' },
  ng: { metric: 'ntgPay', defaultDir: 'max' },
  'n/g de pay': { metric: 'ntgPay', defaultDir: 'max' },
  'porosidad del pay': { metric: 'phiPay', defaultDir: 'max' },
  'phi del pay': { metric: 'phiPay', defaultDir: 'max' },
  'φ del pay': { metric: 'phiPay', defaultDir: 'max' },
  porosidad: { metric: 'phiPay', defaultDir: 'max' },
  phi: { metric: 'phiPay', defaultDir: 'max' },
  'φ': { metric: 'phiPay', defaultDir: 'max' },
  'sw del pay': { metric: 'swPay', defaultDir: 'min' },
  'saturacion de agua del pay': { metric: 'swPay', defaultDir: 'min' },
  sw: { metric: 'swPay', defaultDir: 'min' },
  'saturacion de agua': { metric: 'swPay', defaultDir: 'min' },
  'vsh del pay': { metric: 'vshPay', defaultDir: 'min' },
  'arcillosidad del pay': { metric: 'vshPay', defaultDir: 'min' },
  vsh: { metric: 'vshPay', defaultDir: 'min' },
  arcilla: { metric: 'vshPay', defaultDir: 'min' },
  arcillosidad: { metric: 'vshPay', defaultDir: 'min' },
  permeabilidad: { metric: 'kPay', defaultDir: 'max' },
  k: { metric: 'kPay', defaultDir: 'max' },
  ooip: { metric: 'ooip', defaultDir: 'max' },
  petroleo: { metric: 'ooip', defaultDir: 'max' },
  'petroleo in situ': { metric: 'ooip', defaultDir: 'max' },
  ogip: { metric: 'ogip', defaultDir: 'max' },
  gas: { metric: 'ogip', defaultDir: 'max' },
  'gas in situ': { metric: 'ogip', defaultDir: 'max' },
  'hphish': { metric: 'hphiShPay', defaultDir: 'max' },
  'h·φ·sh': { metric: 'hphiShPay', defaultDir: 'max' },
};

const FUZZY_LEXICON: Readonly<Record<string, string>> = {
  mostrame: 'mostrame',
  mostrar: 'mostrar',
  explicame: 'explicame',
  funciona: 'funciona',
  ecuacion: 'ecuacion',
  ecuaciones: 'ecuaciones',
  porosidad: 'porosidad',
  saturacion: 'saturacion',
  permeabilidad: 'permeabilidad',
  arcillosidad: 'arcillosidad',
  espesor: 'espesor',
  reservorio: 'reservorio',
  hidrocarburos: 'hidrocarburos',
  hidrocarburo: 'hidrocarburo',
  sensibilidad: 'sensibilidad',
  estabilidad: 'estabilidad',
  coherencia: 'coherencia',
  volumetria: 'volumetria',
  incertidumbre: 'incertidumbre',
  calibracion: 'calibracion',
  compartimentalizacion: 'compartimentalizacion',
  preparacion: 'preparacion',
  advertencias: 'advertencias',
  siguiente: 'siguiente',
  superficie: 'superficie',
  movilidad: 'movilidad',
  archie: 'archie',
  simandoux: 'simandoux',
  timur: 'timur',
  larionov: 'larionov',
  thomeer: 'thomeer',
  swanson: 'swanson',
};

export function normalizeQuestion(text: string): string {
  return fold(text).trim().replace(/^[¿¡]+|[?!.]+$/g, '').trim().replace(/\s+/g, ' ');
}

function lookup<T extends Record<string, string>>(values: T, key: string): T[keyof T] | undefined {
  return Object.hasOwn(values, key) ? values[key as keyof T] : undefined;
}

/** Distancia Damerau-Levenshtein restringida (OSA: transposición adyacente = 1) con salida temprana. */
export function levenshtein(a: string, b: string, maxDist = 2): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > maxDist) return maxDist + 1;
  if (a === b) return 0;
  let prev2 = new Array<number>(lb + 1).fill(maxDist + 1);
  let prev = new Array<number>(lb + 1);
  let curr = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let minRow = curr[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cb = b.charCodeAt(j - 1);
      const cost = ca === cb ? 0 : 1;
      let val = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === cb) {
        val = Math.min(val, prev2[j - 2]! + 1);
      }
      curr[j] = val;
      if (val < minRow) minRow = val;
    }
    if (minRow > maxDist) return maxDist + 1;
    [prev2, prev, curr] = [prev, curr, prev2];
  }
  return prev[lb]!;
}

/**
 * Corrección tipográfica determinista y conservadora: solo tokens ≥ 4 letras, nunca tokens cortos (zonas A–E, Sw, Gr…).
 */
export function correctLexiconTypos(normalizedText: string): string {
  const tokens = normalizedText.split(' ');
  const corrected = tokens.map((tok) => {
    if (tok.length < 4 || /[\d/.,<>=-]/.test(tok)) return tok;
    if (Object.hasOwn(FUZZY_LEXICON, tok) || Object.hasOwn(CURVES, tok) || Object.hasOwn(METRICS, tok)) return tok;
    const maxDist = tok.length >= 10 ? 2 : 1;
    let bestWord: string | null = null;
    let bestDist = maxDist + 1;
    let ties = 0;
    for (const candidate of Object.keys(FUZZY_LEXICON)) {
      if (Math.abs(candidate.length - tok.length) > maxDist) continue;
      if (candidate[0] !== tok[0]) continue;
      const d = levenshtein(tok, candidate, maxDist);
      if (d < bestDist) {
        bestDist = d;
        bestWord = FUZZY_LEXICON[candidate]!;
        ties = 1;
      } else if (d === bestDist) {
        ties++;
      }
    }
    return bestWord && ties === 1 ? bestWord : tok;
  });
  return corrected.join(' ');
}

function lookupMetricFuzzy(raw: string): Metric | undefined {
  const direct = lookup(METRICS, raw);
  if (direct) return direct;
  if (raw.length < 6) return undefined;
  const maxDist = 1;
  let best: Metric | undefined;
  let bestDist = maxDist + 1;
  let ties = 0;
  for (const [k, v] of Object.entries(METRICS)) {
    if (k.length < 6 || k[0] !== raw[0] || Math.abs(k.length - raw.length) > maxDist) continue;
    const d = levenshtein(raw, k, maxDist);
    if (d < bestDist) {
      bestDist = d;
      best = v;
      ties = 1;
    } else if (d === bestDist && v !== best) {
      ties++;
    }
  }
  return best && ties === 1 ? best : undefined;
}

function parseCutoffVar(token: string): SweepVariable | null {
  const t = token.trim();
  if (t === 'sw' || t === 'saturacion' || t === 'saturacion de agua') return 'sw';
  if (t === 'vsh' || t === 'arcilla' || t === 'arcillosidad') return 'vsh';
  if (t === 'phi' || t === 'φ' || t === 'phie' || t === 'porosidad' || t === 'porosidad efectiva') return 'phi';
  return null;
}

function parseNumberStr(raw: string): number {
  return Number(raw.replace(',', '.'));
}

function resolveCurveToken(raw: string): string | null {
  const clean = raw.trim().replace(/^curva\s+/, '');
  const found = lookup(CURVES, clean);
  if (found) return found;
  if (/^[a-z0-9_]{2,12}$/.test(clean) && !/^(?:el|la|los|las|en|de|del|que|para|por|con|sin)$/.test(clean)) {
    return clean.toUpperCase();
  }
  return null;
}

export const FRACTION_LIKE_CURVES = new Set([
  'NPHI',
  'PHID',
  'PHIN',
  'PHIS',
  'PHIT',
  'PHIE',
  'PHIT_NMR',
  'PHIE_NMR',
  'BVI_NMR',
  'FFI_NMR',
  'CBW_NMR',
  'SWIRR_NMR',
  'DPHI_NMR',
  'IGR',
  'VSH',
  'SW',
  'SXO',
  'MOS',
  'SHR',
  'MHI',
  'SWI',
  'BVW',
  'SH',
  'U_GR_FRAC',
]);

function parseFilterConditions(expr: string): { combinator: 'and' | 'or'; conditions: FilterCondition[] } | null {
  const masked = expr.replace(
    /\b(entre\s+-?\d+(?:[.,]\d+)?(?:\s*(?:%|v\/v))?)\s+y\s+(-?\d+(?:[.,]\d+)?(?:\s*(?:%|v\/v))?)/g,
    '$1\u0000$2',
  );
  const hasOr = /\s+o\s+/.test(masked) && !/\s+y\s+/.test(masked);
  const parts = masked.split(hasOr ? /\s+o\s+/ : /\s+y\s+/).map((p) => p.replaceAll('\u0000', ' y '));
  const conditions: FilterCondition[] = [];
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) continue;
    const between = /^([a-zφ0-9_ ]+?)\s+(?:esta\s+)?entre\s+(-?\d+(?:[.,]\d+)?)\s*(%|v\/v)?\s+y\s+(-?\d+(?:[.,]\d+)?)\s*(%|v\/v)?$/.exec(part);
    if (between) {
      const curve = resolveCurveToken(between[1]!);
      if (!curve) return null;
      let v1 = parseNumberStr(between[2]!);
      let v2 = parseNumberStr(between[4]!);
      const pct1 = between[3] === '%' || (!between[3] && between[5] === '%');
      const pct2 = between[5] === '%' || (!between[5] && between[3] === '%');
      if (pct1 && FRACTION_LIKE_CURVES.has(curve)) v1 /= 100;
      if (pct2 && FRACTION_LIKE_CURVES.has(curve)) v2 /= 100;
      conditions.push({ curve, op: 'between', value: Math.min(v1, v2), valueMax: Math.max(v1, v2) });
      continue;
    }
    const cmp = /^([a-zφ0-9_ ]+?)\s*(>=|<=|>|<|=|mayor(?: o igual)?(?: que| a)?|menor(?: o igual)?(?: que| a)?|igual a)\s*(-?\d+(?:[.,]\d+)?)\s*(%|v\/v|md|gapi|ohm\.?m|g\/cm3)?$/.exec(part);
    if (!cmp) return null;
    const curve = resolveCurveToken(cmp[1]!);
    if (!curve) return null;
    const opRaw = cmp[2]!.trim();
    const op: FilterOperator =
      opRaw === '>=' || opRaw.startsWith('mayor o igual')
        ? '>='
        : opRaw === '<=' || opRaw.startsWith('menor o igual')
          ? '<='
          : opRaw === '>' || opRaw.startsWith('mayor')
            ? '>'
            : opRaw === '<' || opRaw.startsWith('menor')
              ? '<'
              : '=';
    let value = parseNumberStr(cmp[3]!);
    if (cmp[4] === '%' && FRACTION_LIKE_CURVES.has(curve)) value /= 100;
    conditions.push({ curve, op, value });
  }
  return conditions.length > 0 ? { combinator: hasOr ? 'or' : 'and', conditions } : null;
}

function cleanZoneToken(raw: string): string {
  return raw.trim().replace(/^(?:la )?zona\s+/, '').trim();
}

function parseZoneTail(text: string): { body: string; zone?: string } {
  const m = /^(.*?)\s+(?:en|de|para)\s+(?:la\s+)?zona\s+([a-z0-9_-]+(?:\s+[a-z0-9_-]+)?)$/.exec(text);
  if (m) return { body: m[1]!.trim(), zone: m[2]!.trim() };
  return { body: text };
}

export function interpretQuestion(question: string): Intent | null {
  const rawNormalized = normalizeQuestion(question);
  if (!rawNormalized) return null;
  // Exact parser first; conservative typo recovery only on fallback
  return parseNormalized(rawNormalized) ?? parseNormalized(correctLexiconTypos(rawNormalized));
}

function parseNormalized(text: string): Intent | null {
  // 1. Follow-up contextual corto ("¿y en la zona E?", "¿y para gas?", "¿y con Sw a 0,55?")
  if (/^y\b/.test(text)) {
    const fZone = /^y\s+(?:en|para|de)?\s*(?:la\s+)?zona\s+([a-z0-9_-]+(?:\s+[a-z0-9_-]+)?)$/.exec(text);
    if (fZone) return { kind: 'followup', zone: fZone[1]! };
    if (/^y\s+(?:en\s+(?:el\s+)?)?(?:total|todo el pozo|pozo completo)$/.test(text)) {
      return { kind: 'followup', wholeWell: true };
    }
    if (/^y\s+(?:para|con|si es)?\s*(gas|ogip|petroleo|ooip)$/.test(text)) {
      const m = /(gas|ogip)/.test(text);
      return { kind: 'followup', fluid: m ? 'gas' : 'oil' };
    }
    const fCut = /^y\s+(?:con\s+(?:el\s+cutoff\s+de\s+)?|si\s+(?:pongo|cambio|muevo)\s+(?:el\s+)?(?:cutoff\s+de\s+)?|a\s+)?(?:(sw|vsh|phi|φ|porosidad)\s*(?:a|en|=)?\s*)?(\d+(?:[.,]\d+)?)\s*(%|v\/v)?$/.exec(text);
    if (fCut) {
      const rawVal = parseNumberStr(fCut[2]!);
      const threshold = fCut[3] === '%' ? rawVal / 100 : rawVal;
      const variable = fCut[1] ? parseCutoffVar(fCut[1]) ?? undefined : undefined;
      return { kind: 'followup', cutoff: { ...(variable ? { variable } : {}), threshold } };
    }
  }

  // 2. Consultas por profundidad (@ MD), "¿por qué a 7950 m no es pay?", "¿de dónde sale PHIE a 7820 m?"
  const whyPayAt = /^por que (?:(?:a|en)\s+)?(?:md\s+)?(\d+(?:[.,]\d+)?)\s*m?\s+no es pay(?:\s+neto)?$/.exec(text);
  if (whyPayAt) return { kind: 'depth', depth: parseNumberStr(whyPayAt[1]!), mode: 'why-pay' };

  const provAt = /^(?:de donde sale|origen de|trazabilidad de|cadena de)\s+([a-zφ0-9_ ]+?)\s+(?:a|en)\s+(?:md\s+)?(\d+(?:[.,]\d+)?)\s*m?$/.exec(text);
  if (provAt) {
    const role = resolveCurveToken(provAt[1]!) as CurveRole | null;
    if (role) return { kind: 'depth', depth: parseNumberStr(provAt[2]!), mode: 'provenance', role };
  }

  const readAt = /^(?:(?:que (?:valores|curvas) hay|valores|curvas|lectura|datos)\s+(?:a|en)|@)\s*(?:md\s+)?(\d+(?:[.,]\d+)?)\s*m?$/.exec(text)
    ?? /^(?:md\s+)?(\d+(?:[.,]\d+)?)\s*m$/.exec(text);
  if (readAt) return { kind: 'depth', depth: parseNumberStr(readAt[1]!), mode: 'readout' };

  // 3. Filtro booleano sobre curvas ("Resaltá donde φ > 0,15 y Sw < 0,4 en zona D")
  const filterMatch = /^(?:resalta(?:r|me)?|busca(?:r|me)?|filtra(?:r|me)?|selecciona(?:r|me)?|mostrame|donde)(?:\s+(?:las )?muestras)?(?:\s+donde|\s+con)?\s+(.+)$/.exec(text);
  if (filterMatch && !/^donde hay (?:hidrocarburos?|agua)/.test(text)) {
    const rest = filterMatch[1]!.trim();
    // Solo considerar filtro si contiene un operador booleano/relacional claro
    if (/[<>]|=|mayor|menor|entre\s+\d/.test(rest)) {
      const { body, zone } = parseZoneTail(rest);
      const parsed = parseFilterConditions(body);
      if (parsed) {
        return {
          kind: 'filter-select',
          combinator: parsed.combinator,
          conditions: parsed.conditions,
          ...(zone ? { zone } : {}),
        };
      }
    }
  }

  // 4. Ver curva en zona (F26)
  const profile = /^(?:mostrame|mostrar|ver|quiero ver)\s+(.+?)\s+en\s+(?:la\s+)?zona\s+(.+)$/.exec(text);
  if (profile) {
    const role = lookup(CURVES, profile[1]!);
    if (role) return { kind: 'profile', role, zone: profile[2]! };
  }

  // 5. Diagnóstico de poco pay en zona (F26 + variantes naturales)
  const pay =
    /^por que (?:la )?zona (.+?) tiene (?:poco|tan poco|cero|bajo) pay$/.exec(text) ??
    /^(?:que limita|por que hay poco) (?:el )?pay(?: en (?:la )?zona)? (.+)$/.exec(text);
  if (pay) return { kind: 'pay', zone: cleanZoneToken(pay[1]!) };

  // 6. Simulación de 1 o 2 cutoffs + estabilidad 2D (G09)
  const stab = /^(?:cual es la )?(?:estabilidad(?:\s+2d)?(?:\s+de(?:\s+los)?\s+cutoffs?)?|superficie\s+2d(?:\s+de\s+cutoffs?)?|acantilados?(?:\s+de\s+cutoffs?)?|que tan estable es el pay)(?:\s+(?:en|de)\s+(?:la\s+)?zona\s+([a-z0-9_-]+(?:\s+[a-z0-9_-]+)?))?$/.exec(text);
  if (stab) return { kind: 'cutoff-stability', ...(stab[1] ? { zone: stab[1] } : {}) };

  const simHeader = /^(?:que pasa si (?:pongo|cambio|muevo|fijo|dejo|bajo|subo)|simula(?:r|me)?|sensibilidad(?: del| de)?)\s+(.+)$/.exec(text);
  if (simHeader) {
    const { body, zone } = parseZoneTail(simHeader[1]!);
    const clauseRe = /(?:el\s+)?(?:cutoff(?:\s+de)?\s+)?(vsh|sw|phi|φ|porosidad efectiva|porosidad|saturacion de agua|saturacion|arcillosidad|arcilla)\s*(?:a|en|=|<=|>=)?\s*(\d+(?:[.,]\d+)?)\s*(%|v\/v)?/g;
    const changes: { variable: SweepVariable; threshold: number }[] = [];
    const seenVars = new Set<SweepVariable>();
    for (const m of body.matchAll(clauseRe)) {
      const v = parseCutoffVar(m[1]!);
      if (!v || seenVars.has(v)) continue;
      const num = parseNumberStr(m[2]!);
      seenVars.add(v);
      changes.push({ variable: v, threshold: m[3] === '%' ? num / 100 : num });
    }
    if (changes.length === 1) {
      return { kind: 'cutoff', variable: changes[0]!.variable, threshold: changes[0]!.threshold, ...(zone ? { zone } : {}) };
    }
    if (changes.length >= 2) {
      return { kind: 'cutoff-pair', changes, ...(zone ? { zone } : {}) };
    }
  }

  // 7. Comparación y ranking entre zonas
  const pairCmp = /^(?:compara(?:r|me)?|diferencia entre)\s+(?:la\s+)?(?:zona\s+)?([a-z0-9_-]+(?:\s+[a-z0-9_-]+)?)\s+(?:vs|contra|con|y)\s+(?:la\s+)?(?:zona\s+)?([a-z0-9_-]+(?:\s+[a-z0-9_-]+)?)$/.exec(text);
  if (pairCmp && !/^(?:todas|zonas)\b/.test(pairCmp[1]!)) {
    return { kind: 'compare', mode: 'pair', zones: [pairCmp[1]!, pairCmp[2]!] };
  }
  if (/^(?:compara(?:r|me)? (?:todas )?las zonas|comparativa(?: de zonas)?|tabla comparativa|todas las zonas)$/.test(text)) {
    return { kind: 'compare', mode: 'all' };
  }
  const rankCmp = /^(?:que zona|cual(?: zona)?)(?: es la que)? tiene (mas|mayor|mejor|menos|menor|peor)\s+(.+?)(?:\s+en el pozo)?$/.exec(text)
    ?? /^(?:ranking|ordena(?:r)? zonas)(?: por)?\s+(.+)$/.exec(text);
  if (rankCmp) {
    const dirToken = rankCmp[2] ? rankCmp[1]! : 'mejor';
    const metricRaw = (rankCmp[2] ?? rankCmp[1]!).trim();
    const spec = COMPARE_METRICS[metricRaw] ?? (lookupMetricFuzzy(metricRaw) ? { metric: lookupMetricFuzzy(metricRaw)!, defaultDir: 'max' as const } : undefined);
    if (spec) {
      const direction: 'max' | 'min' =
        dirToken === 'menos' || dirToken === 'menor' || dirToken === 'peor'
          ? 'min'
          : dirToken === 'mas' || dirToken === 'mayor'
            ? 'max'
            : spec.defaultDir;
      return { kind: 'compare', mode: 'rank', metric: spec.metric, direction };
    }
  }

  // 8. Volumetría (OOIP / OGIP)
  const volRegex = /^(?:cual es (?:el |la )?|cuanto |cuanta |mostrame (?:el |la )?|ver )?(ooip|ogip|petroleo in situ(?:\s*\(ooip\))?|gas in situ(?:\s*\(ogip\))?|volumetria|volumenes?(?: in situ)?)(?:\s+(?:hay|tiene))?(?:\s+(?:en|de)\s+(?:la\s+)?zona\s+([a-z0-9_-]+(?:\s+[a-z0-9_-]+)?)|\s+(?:del pozo|total))?$/.exec(text);
  if (volRegex) {
    const k = volRegex[1]!;
    const fluid = k === 'ooip' || k.startsWith('petroleo') ? 'oil' : k === 'ogip' || k.startsWith('gas') ? 'gas' : 'both';
    return { kind: 'volume', fluid, ...(volRegex[2] ? { zone: volRegex[2] } : {}) };
  }

  // 9. Cambios respecto a snapshot o defaults ("¿Qué cambié?")
  const snapSpecific = /^(?:que cambie|que modifique|diferencias|cambios)(?: respecto a(?:l snapshot)?| con(?: el snapshot)?| vs(?: snapshot)?)\s+(.+)$/.exec(text);
  if (snapSpecific) {
    const t = snapSpecific[1]!.replace(/^["'«]|["'»]$/g, '').trim();
    if (/^(?:fabrica|defaults?|valores de fabrica|original)$/.test(t)) return { kind: 'snapshot-diff', vsDefaults: true };
    return { kind: 'snapshot-diff', target: t };
  }
  if (/^(?:que cambie|que modifique|que cambios hice|ver cambios|diferencias con (?:el )?snapshot)(?:\s+en\s+(?:la\s+)?interpretacion)?$/.test(text)) {
    return { kind: 'snapshot-diff' };
  }

  // 10. Diagnóstico de grafo / sarta / preparación
  if (/^(?:que exclui|que limpie|que modifique|resumen de|que hay)(?: en)? (?:la )?preparacion(?: de datos)?$/.test(text)) {
    return { kind: 'graph-diag', focus: 'preparation' };
  }
  const missingDiag = /^por que no (?:se )?(?:calcula|calculo|sale|aparece|tengo|esta)\s+(?:el |la )?([a-z0-9_ ]+)$/.exec(text)
    ?? /^por que falta\s+(?:el |la )?([a-z0-9_ ]+)$/.exec(text);
  if (missingDiag) {
    return { kind: 'graph-diag', focus: 'missing', target: missingDiag[1]!.trim() };
  }
  if (/^(?:que modulos (?:fallaron|no corrieron|faltan)|diagnostico del grafo|estado de la sarta)$/.test(text)) {
    return { kind: 'graph-diag', focus: 'missing' };
  }

  // 11. Métodos / Ecuaciones — evaluar antes de dominios genéricos para que "¿Qué es Archie?" o "¿Qué es Thomeer?" vaya a Ecuaciones
  const method = /^(?:como funciona|que es|explicame|(?:ecuacion|ecuaciones) de)\s+(?:el |la |los |las )?(.+)$/.exec(text);
  if (method) return { kind: 'method', query: method[1]! };

  // 12. Dominios petrofísicos especializados (G03, G05, G06, G07, G08, MICP, punzados, Monte Carlo, corona)
  {
    const { body, zone } = parseZoneTail(text);
    const zOpt = zone ? { zone } : {};

    if (/^(?:(?:como esta|revisar|ver|estado de|resumen de|cual es) (?:la )?)?(?:coherencia cruzada|coherencia|tensiones(?: del pozo)?|hay incoherencias|incoherencias|semaforo|sw vs swi|agua ligada|bvw vs bvi)$/.test(body)) {
      const checkId: CrossCheckId | undefined = body.includes('swi')
        ? 'sw-vs-swi'
        : body.includes('agua ligada') || body.includes('bvw')
          ? 'bound-water'
          : undefined;
      return { kind: 'cross-check', ...zOpt, ...(checkId ? { checkId } : {}) };
    }
    if (/^(?:(?:ver|revisar|resumen de|como estan) (?:las |los )?)?(?:presiones mdt|mdt|contactos?(?: mdt| de fluidos)?|emw|sobrepresion|compartimentalizacion|gradientes? (?:mdt|de presion))$/.test(body)) {
      const focus = body.includes('contacto') ? 'contacts' : body.includes('emw') || body.includes('sobrepresion') || body.includes('compartimentalizacion') ? 'emw' : 'all';
      return { kind: 'mdt', ...zOpt, focus };
    }
    if (/^(?:(?:ver|resumen de) )?(?:smlp|curvas? de lorenz|coeficiente de lorenz|capacidad de flujo|unidades hidraulicas(?:\s+smlp)?|conductos y barreras|flujo y lorenz)(?:\s+y\s+lorenz)?$/.test(body)) {
      return { kind: 'smlp', ...zOpt };
    }
    if (/^(?:(?:ver|resumen de) )?(?:calibracion\s+)?(?:cgr|gr espectral|uranio(?: en gr)?|aporte de uranio|fraccion de uranio|calibracion(?: de)? cgr)(?:\s+y\s+(?:aporte|fraccion)\s+de\s+uranio)?$/.test(body)) {
      return { kind: 'cgr', ...zOpt };
    }
    if (/^(?:(?:ver|resumen de|cual es (?:la|el))\s+)?(?:sxo|movilidad(?:\s+de\s+hidrocarburo)?(?:\s+sxo(?:\s+y\s+mos)?)?|hidrocarburo movil|mos|mhi|shr|invasion|zona lavada)$/.test(body)) {
      return { kind: 'movability', ...zOpt };
    }
    if (/^(?:(?:ver|resumen de|como esta) (?:la |de )?)?(?:micp|presion capilar|thomeer|swanson|capacidad de sello|gargantas porales|altura de entrada|sello micp)(?:\s+y\s+(?:capacidad de sello|thomeer|swanson))?$/.test(body)) {
      return { kind: 'micp', ...zOpt };
    }
    if (/^(?:(?:cuales son las |ver )?capas de pay(?:\s+y\s+punzados(?:\s+sugeridos)?)?|punzados(?:\s+sugeridos)?|que intervalos punzar|mejores capas(?: de pay)?)$/.test(body)) {
      return { kind: 'pay-layers', ...zOpt };
    }
    if (/^(?:(?:ver|resumen de) )?(?:incertidumbre(?:\s+p90\s+p50\s+p10)?|monte carlo|p90 p50 p10|cuantiles|tornado(?:\s+de\s+incertidumbre)?|que parametro domina(?: el volumen)?)(?:\s+y\s+tornado)?$/.test(body)) {
      const focus = body.includes('tornado') || body.includes('domina') ? 'tornado' : body.includes('p90') || body.includes('cuantil') ? 'quantiles' : 'all';
      return { kind: 'uncertainty', ...zOpt, focus };
    }
    if (/^(?:(?:ver|resumen de|como esta) (?:la )?)?(?:calibracion con corona|calibracion corona|corona|plugs|rhomaa|densidad de matriz|exponente m de corona)(?:\s+y\s+(?:ρmaa|rhomaa|plugs))?$/.test(body)) {
      return { kind: 'core', ...zOpt };
    }
  }

  // 13. Sumario F26 (con tolerancia tipográfica en métrica larga)
  const metric = /^(?:cual es (?:el |la )?|cuanto |cuanta |mostrame (?:el |la )?|ver (?:el |la )?)?(.+?)(?: hay| tiene)?(?: (?:en|de) (?:la )?zona (.+)| (?:del pozo|total))?$/.exec(text);
  if (metric) {
    const key = lookupMetricFuzzy(metric[1]!);
    if (key) return { kind: 'summary', metric: key, ...(metric[2] ? { zone: metric[2] } : {}) };
  }

  // 14. Lectura automática F26
  const reading = /^(?:donde hay (hidrocarburos?|agua)|lectura(?: automatica)?(?: del pozo)?)(?: en (?:la )?zona (.+))?$/.exec(text);
  if (reading) {
    return {
      kind: 'reading',
      ...(reading[1] ? { phase: reading[1] === 'agua' ? 'water' : 'hydrocarbon' } : {}),
      ...(reading[2] ? { zone: reading[2] } : {}),
    };
  }

  // 15. Avisos y siguiente paso (F26)
  const warnings = /^(?:(?:que )?avisos(?: hay)?|(?:que )?advertencias(?: hay)?)(?: en (?:la )?zona (.+))?$/.exec(text);
  if (warnings) return { kind: 'warnings', ...(warnings[1] ? { zone: warnings[1] } : {}) };
  return /^(?:que sigue|que paso sigue|siguiente paso|que reviso ahora)$/.test(text) ? { kind: 'next' } : null;
}
