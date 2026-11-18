type Sample = (reference: string) => number | undefined;
type Expression = (sample: Sample) => number;

export const FORMULA_LENGTH = 512;

const functions = new Map<string, { arity: number; apply: (...values: number[]) => number }>([
  ['LOG', { arity: 1, apply: Math.log }],
  ['EXP', { arity: 1, apply: Math.exp }],
  ['MIN', { arity: 2, apply: Math.min }],
  ['MAX', { arity: 2, apply: Math.max }],
]);

const operators = new Map<string, (a: number, b: number) => number>([
  ['+', (a, b) => a + b], ['-', (a, b) => a - b],
  ['*', (a, b) => a * b], ['/', (a, b) => a / b],
]);

const finite = (value: number | undefined) => value !== undefined && Number.isFinite(value) ? value : NaN;

export function parseFormula(text: string): { references: readonly string[]; evaluate: Expression } {
  if (text.length > FORMULA_LENGTH) throw new Error(`La fórmula admite hasta ${FORMULA_LENGTH} caracteres.`);
  let offset = 0;
  const references = new Set<string>();
  const token = /\s+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|@?[A-Za-z_][A-Za-z0-9_]*|[+*/(),-]/y;
  const error = (message: string): never => { throw new Error(`Sintaxis, columna ${offset + 1}: ${message}`); };
  const peek = () => {
    token.lastIndex = offset;
    let word = token.exec(text)?.[0];
    if (word && /^\s/.test(word)) {
      offset += word.length;
      word = token.exec(text)?.[0];
    }
    if (!word && offset < text.length) error(`carácter inesperado «${text[offset]}».`);
    return word?.toUpperCase() ?? '';
  };
  const take = (word: string) => {
    if (peek() !== word) error(`se esperaba «${word}».`);
    offset += word.length;
  };
  const binary = (next: () => Expression, symbols: readonly string[]): Expression => {
    let left = next();
    let op = peek();
    while (symbols.includes(op)) {
      take(op);
      const evaluate = operators.get(op)!;
      const a = left;
      const b = next();
      left = sample => finite(evaluate(a(sample), b(sample)));
      op = peek();
    }
    return left;
  };
  const expression = (): Expression => binary(term, ['+', '-']);
  const term = (): Expression => binary(unary, ['*', '/']);
  const unary = (): Expression => {
    const word = peek();
    if (word === '+' || word === '-') {
      take(word);
      const value = unary();
      return word === '-' ? sample => -value(sample) : value;
    }
    if (word === '(') {
      take('(');
      const value = expression();
      take(')');
      return value;
    }
    if (/^[\d.]/.test(word)) {
      const value = Number(word);
      if (!Number.isFinite(value)) error('el número no es finito.');
      take(word);
      return () => value;
    }
    if (/^@?[A-Z_]/.test(word)) {
      take(word);
      if (peek() === '(') {
        const fn = functions.get(word) ?? error(`función desconocida «${word}».`);
        take('(');
        const args = [expression()];
        if (fn.arity === 2) {
          take(',');
          args.push(expression());
        }
        take(')');
        return sample => finite(fn.apply(...args.map(arg => arg(sample))));
      }
      references.add(word);
      return sample => finite(sample(word));
    }
    return error('se esperaba un número, una referencia o un paréntesis.');
  };
  const evaluate = expression();
  if (peek()) error('se esperaba un operador o el final de la fórmula.');
  return { references: [...references], evaluate };
}
