import { fold } from '../../ui/commands';

const CURVES = {
  gr: 'GR', rt: 'RT', vsh: 'VSH', sw: 'SW', 'saturacion de agua': 'SW',
  phi: 'PHIE', 'φ': 'PHIE', phie: 'PHIE', porosidad: 'PHIE', 'porosidad efectiva': 'PHIE',
} as const;

const METRICS = {
  bruto: 'gross', 'espesor bruto': 'gross', 'arena neta': 'netSand',
  'reservorio neto': 'netRes', pay: 'netPay', 'pay neto': 'netPay', 'espesor de pay': 'netPay',
  'n/g de pay': 'ntgPay', 'porosidad del pay': 'phiPay', 'sw del pay': 'swPay', 'vsh del pay': 'vshPay',
} as const;

export type CurveRole = (typeof CURVES)[keyof typeof CURVES];
export type Metric = (typeof METRICS)[keyof typeof METRICS];

export type Intent =
  | { kind: 'profile'; role: CurveRole; zone: string }
  | { kind: 'summary'; metric: Metric; zone?: string }
  | { kind: 'pay'; zone: string }
  | { kind: 'cutoff'; variable: 'sw' | 'phi' | 'vsh'; threshold: number; zone?: string }
  | { kind: 'reading'; phase?: 'hydrocarbon' | 'water'; zone?: string }
  | { kind: 'method'; query: string }
  | { kind: 'warnings'; zone?: string }
  | { kind: 'next' };

export function normalizeQuestion(text: string): string {
  return fold(text).trim().replace(/^[¿¡]+|[?!]+$/g, '').trim().replace(/\s+/g, ' ');
}

function lookup<T extends Record<string, string>>(values: T, key: string): T[keyof T] | undefined {
  return Object.hasOwn(values, key) ? values[key as keyof T] : undefined;
}

export function interpretQuestion(question: string): Intent | null {
  const text = normalizeQuestion(question);
  const profile = /^(?:mostrame|mostrar|ver|quiero ver) (.+?) en (?:la )?zona (.+)$/.exec(text);
  if (profile) {
    const role = lookup(CURVES, profile[1]!);
    if (role) return { kind: 'profile', role, zone: profile[2]! };
  }
  const pay = /^por que (?:la )?zona (.+?) tiene (?:poco|tan poco|cero|bajo) pay$/.exec(text);
  if (pay) return { kind: 'pay', zone: pay[1]! };

  const cutoff = /^(?:que pasa si (?:pongo|cambio|muevo)|sensibilidad del) (?:el )?cutoff de (sw|vsh|phi|φ|porosidad) a (\d+(?:[.,]\d+)?)\s*(%|v\/v)?(?: en (?:la )?zona (.+))?$/.exec(text);
  if (cutoff) {
    const variable = cutoff[1] === 'sw' ? 'sw' : cutoff[1] === 'vsh' ? 'vsh' : 'phi';
    const value = Number(cutoff[2]!.replace(',', '.'));
    return { kind: 'cutoff', variable, threshold: cutoff[3] === '%' ? value / 100 : value, ...(cutoff[4] ? { zone: cutoff[4] } : {}) };
  }

  const metric = /^(?:cual es (?:el |la )?|cuanto |cuanta |mostrame (?:el |la )?|ver (?:el |la )?)?(.+?)(?: hay| tiene)?(?: (?:en|de) (?:la )?zona (.+)| (?:del pozo|total))?$/.exec(text);
  if (metric) {
    const key = lookup(METRICS, metric[1]!);
    if (key) return { kind: 'summary', metric: key, ...(metric[2] ? { zone: metric[2] } : {}) };
  }

  const reading = /^(?:donde hay (hidrocarburos?|agua)|lectura(?: automatica)?(?: del pozo)?)(?: en (?:la )?zona (.+))?$/.exec(text);
  if (reading) return {
    kind: 'reading',
    ...(reading[1] ? { phase: reading[1] === 'agua' ? 'water' : 'hydrocarbon' } : {}),
    ...(reading[2] ? { zone: reading[2] } : {}),
  };

  const method = /^(?:como funciona|que es|explicame|(?:ecuacion|ecuaciones) de) (?:el |la |los |las )?(.+)$/.exec(text);
  if (method) return { kind: 'method', query: method[1]! };
  const warnings = /^(?:(?:que )?avisos(?: hay)?|(?:que )?advertencias(?: hay)?)(?: en (?:la )?zona (.+))?$/.exec(text);
  if (warnings) return { kind: 'warnings', ...(warnings[1] ? { zone: warnings[1] } : {}) };
  return /^(?:que sigue|que paso sigue|siguiente paso|que reviso ahora)$/.test(text) ? { kind: 'next' } : null;
}
