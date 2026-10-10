/**
 * Comprobación de buena formación de XML para los tests de SVG (sin DOMParser: los tests corren en Node). Verifica que
 * las etiquetas se abren y cierran en orden, que los atributos van entre comillas y sin repetirse, que no hay `&` sin
 * escapar y que el documento tiene una sola raíz. Devuelve conteos por etiqueta.
 */
export interface XmlReport {
  root: string;
  counts: Map<string, number>;
  /** Atributos de cada elemento, en orden de aparición. */
  elements: { name: string; attrs: Record<string, string>; text: string }[];
}

export function checkXml(xml: string): XmlReport {
  let s = xml;
  if (s.startsWith('<?xml')) {
    const end = s.indexOf('?>');
    if (end < 0) throw new Error('Declaración XML sin cerrar.');
    s = s.slice(end + 2);
  }
  const stack: string[] = [];
  const counts = new Map<string, number>();
  const elements: XmlReport['elements'] = [];
  let root = '';
  let rootsClosed = 0;
  let i = 0;
  const textOf = (t: string) => {
    if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(t)) throw new Error(`Entidad sin escapar en «${t.slice(0, 40)}».`);
    if (/<|>/.test(t)) throw new Error('Carácter < o > sin escapar en el texto.');
  };
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) {
      if (s.slice(i).trim()) throw new Error('Texto fuera de la raíz.');
      break;
    }
    const text = s.slice(i, lt);
    if (text.trim() && stack.length === 0) throw new Error('Texto fuera de la raíz.');
    textOf(text);
    if (stack.length && elements.length) elements[elements.length - 1]!.text += text;
    const gt = s.indexOf('>', lt);
    if (gt < 0) throw new Error('Etiqueta sin cerrar.');
    const tag = s.slice(lt + 1, gt);
    i = gt + 1;
    if (tag.startsWith('!--')) continue;
    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim();
      if (stack.pop() !== name) throw new Error(`Cierre </${name}> fuera de orden.`);
      if (stack.length === 0) rootsClosed++;
      continue;
    }
    const selfClose = tag.endsWith('/');
    const body = selfClose ? tag.slice(0, -1) : tag;
    const m = /^([A-Za-z_][\w:.-]*)((?:\s+[A-Za-z_:][\w:.-]*="[^"<]*")*)\s*$/.exec(body);
    if (!m) throw new Error(`Etiqueta mal formada: <${body.slice(0, 80)}>.`);
    const attrs: Record<string, string> = {};
    for (const a of m[2]!.matchAll(/([A-Za-z_:][\w:.-]*)="([^"<]*)"/g)) {
      if (a[1]! in attrs) throw new Error(`Atributo repetido: ${a[1]} en <${m[1]}>.`);
      textOf(a[2]!);
      attrs[a[1]!] = a[2]!;
    }
    if (stack.length === 0) {
      if (rootsClosed) throw new Error('Más de una raíz.');
      root = m[1]!;
    }
    counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
    elements.push({ name: m[1]!, attrs, text: '' });
    if (selfClose) {
      if (stack.length === 0) rootsClosed++;
    } else stack.push(m[1]!);
  }
  if (stack.length) throw new Error(`Etiquetas sin cerrar: ${stack.join(', ')}.`);
  if (!root) throw new Error('Documento vacío.');
  return { root, counts, elements };
}
