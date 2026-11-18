import { parseFormula } from '../petro/formula';
import { isKnownUnit, type UnitId } from './units';

export interface CurveFormula {
  mnemonic: string;
  expression: string;
  unit: UnitId;
}

export const FORMULA_NAME = /^[A-Z][A-Z0-9_]{0,31}$/;
export const MAX_FORMULAS = 64;
export const formulaModuleId = (mnemonic: string) => `formula-${mnemonic.toLowerCase().replace(/x/g, 'xx').replace(/_/g, 'xu')}`;

export function sanitizeFormulas(raw: unknown, warn: (message: string) => void): CurveFormula[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > MAX_FORMULAS) {
    warn(`Se esperaba una lista de hasta ${MAX_FORMULAS} fórmulas.`);
    return undefined;
  }
  const formulas: CurveFormula[] = [];
  const names = new Set<string>();
  for (const value of raw) {
    const { mnemonic, expression, unit } = (value ?? {}) as Partial<CurveFormula>;
    if (typeof mnemonic !== 'string' || !FORMULA_NAME.test(mnemonic) || names.has(mnemonic) ||
        typeof expression !== 'string' || typeof unit !== 'string' || !isKnownUnit(unit)) {
      warn('Definición de curva por fórmula inválida o repetida.');
      continue;
    }
    try {
      parseFormula(expression);
      names.add(mnemonic);
      formulas.push({ mnemonic, expression, unit });
    } catch (error) {
      warn(`Fórmula ${mnemonic}: ${(error as Error).message}`);
    }
  }
  return formulas;
}
