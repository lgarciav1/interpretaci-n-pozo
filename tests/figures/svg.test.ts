/** Grabador de SVG (src/io/export/figures/svg.ts): golden pequeños de cada operación que usa el dibujo, y SVG bien formado. */
import { describe, expect, it } from 'vitest';
import { PathBuilder, SvgContext2D, SvgPath2D, approximateMeasure, parseCssColor, parseFont, withSvgPath2D } from '../../src/io/export/figures';
import { checkXml } from './xml';

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">';
const TAIL = '</svg>\n';
const make = () => new SvgContext2D({ width: 100, height: 50 });
/** Contenido del SVG entre la raíz y su cierre (se verifica además que el documento esté bien formado). */
const body = (c: SvgContext2D, bg?: string): string => {
  const svg = c.toSvg(bg);
  checkXml(svg);
  expect(svg.startsWith(HEAD)).toBe(true);
  expect(svg.endsWith(TAIL)).toBe(true);
  return svg.slice(HEAD.length, svg.length - TAIL.length);
};

describe('líneas y trazos', () => {
  it('una polilínea con color, grosor y transformación', () => {
    const c = make();
    c.strokeStyle = '#ff0000';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(10, 10.5);
    c.lineTo(90, 10.5);
    c.stroke();
    expect(body(c)).toBe('<path d="M10 10.5L90 10.5" fill="none" stroke="#ff0000" stroke-width="2"/>');
  });

  it('unión y terminación redondas solo se escriben si no son las de por defecto', () => {
    const c = make();
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(5, 5);
    c.stroke();
    expect(body(c)).toBe('<path d="M0 0L5 5" fill="none" stroke="#000000" stroke-width="1" stroke-linejoin="round" stroke-linecap="round"/>');
  });

  it('rayas: lista, repetición de una lista impar, valor inválido ignorado y restablecida por restore()', () => {
    const c = make();
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(9, 0);
    c.setLineDash([4, 3]);
    c.stroke();
    c.save();
    c.setLineDash([5]);
    expect(c.getLineDash()).toEqual([5, 5]);
    c.setLineDash([-1, 2]); // inválida: se ignora, como el canvas
    expect(c.getLineDash()).toEqual([5, 5]);
    c.stroke();
    c.restore();
    expect(c.getLineDash()).toEqual([4, 3]);
    c.setLineDash([]);
    c.stroke();
    expect(body(c)).toBe(
      [
        '<path d="M0 0L9 0" fill="none" stroke="#000000" stroke-width="1" stroke-dasharray="4 3"/>',
        '<path d="M0 0L9 0" fill="none" stroke="#000000" stroke-width="1" stroke-dasharray="5 5"/>',
        '<path d="M0 0L9 0" fill="none" stroke="#000000" stroke-width="1"/>',
      ].join(''),
    );
  });

  it('strokeRect', () => {
    const c = make();
    c.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    c.strokeRect(1.5, 2.5, 10, 20);
    expect(body(c)).toBe('<rect x="1.5" y="2.5" width="10" height="20" fill="none" stroke="#000000" stroke-opacity="0.25" stroke-width="1"/>');
  });
});

describe('rellenos y transparencia', () => {
  it('fillRect con rgba → hex + fill-opacity, y la transparencia global se multiplica', () => {
    const c = make();
    c.fillStyle = 'rgba(0, 128, 255, 0.5)';
    c.fillRect(5, 5, 20, 10);
    c.globalAlpha = 0.5;
    c.fillRect(5, 5, 20, 10);
    expect(body(c)).toBe(
      '<rect x="5" y="5" width="20" height="10" fill="#0080ff" fill-opacity="0.5"/>' + '<rect x="5" y="5" width="20" height="10" fill="#0080ff" fill-opacity="0.25"/>',
    );
  });

  it('un Path2D se rellena con una sola etiqueta y respeta translate()', () => {
    const c = make();
    const p = new SvgPath2D();
    p.moveTo(0, 0);
    p.lineTo(10, 0);
    p.lineTo(10, 10);
    p.closePath();
    c.fillStyle = '#00ff00';
    c.fill(p);
    c.translate(5, 6);
    c.fill(p);
    expect(body(c)).toBe('<path d="M0 0L10 0L10 10Z" fill="#00ff00"/>' + '<path d="M0 0L10 0L10 10Z" fill="#00ff00" transform="matrix(1 0 0 1 5 6)"/>');
  });

  it('un trazado vacío no emite nada y un color transparente tampoco pinta', () => {
    const c = make();
    c.beginPath();
    c.fill();
    c.stroke();
    c.fillStyle = 'rgba(10, 10, 10, 0)';
    c.fillRect(0, 0, 5, 5);
    expect(body(c)).toBe('<rect x="0" y="0" width="5" height="5" fill="none"/>');
  });

  it('fondo opcional detrás de todo', () => {
    const c = make();
    c.fillStyle = '#123456';
    c.fillRect(0, 0, 1, 1);
    expect(body(c, '#ffffff')).toBe('<rect width="100" height="50" fill="#ffffff"/><rect x="0" y="0" width="1" height="1" fill="#123456"/>');
  });

  it('formas: círculo entero (dos mitades), cuarto, tres cuartos, antihorario y rectángulo redondeado', () => {
    const d = (f: (p: PathBuilder) => void) => {
      const p = new PathBuilder();
      f(p);
      return p.d;
    };
    expect(d((p) => p.arc(50, 25, 10, 0, 2 * Math.PI))).toBe('M60 25A10 10 0 0 1 40 25A10 10 0 0 1 60 25');
    expect(d((p) => p.arc(0, 0, 10, 0, Math.PI / 2))).toBe('M10 0A10 10 0 0 1 0 10');
    expect(d((p) => p.arc(0, 0, 10, 0, (3 * Math.PI) / 2))).toBe('M10 0A10 10 0 1 1 0 -10');
    expect(d((p) => p.arc(0, 0, 10, 0, Math.PI / 2, true))).toBe('M10 0A10 10 0 1 0 0 10');
    // Con un subtrazado abierto, arc() une el punto actual con el comienzo del arco, como el canvas.
    expect(d((p) => (p.moveTo(0, 0), p.arc(10, 0, 5, 0, Math.PI)))).toBe('M0 0L15 0A5 5 0 0 1 5 0');
    expect(d((p) => p.roundRect(0, 0, 20, 10, 3))).toBe('M3 0L17 0A3 3 0 0 1 20 3L20 7A3 3 0 0 1 17 10L3 10A3 3 0 0 1 0 7L0 3A3 3 0 0 1 3 0Z');
    expect(d((p) => p.roundRect(0, 0, 20, 10, 0))).toBe('M0 0L20 0L20 10L0 10Z');
    // Valores no finitos no ensucian el trazado (no aparece NaN en el archivo).
    expect(d((p) => (p.moveTo(NaN, 1), p.lineTo(1, Infinity), p.rect(0, NaN, 1, 1)))).toBe('');
  });
});

describe('recorte', () => {
  it('clip() agrupa lo que se dibuja hasta el restore() y deja definido el clipPath', () => {
    const c = make();
    c.save();
    c.beginPath();
    c.rect(0, 0, 50, 50);
    c.clip();
    c.fillStyle = '#000';
    c.fillRect(10, 10, 100, 5);
    c.restore();
    c.fillStyle = '#111111';
    c.fillRect(0, 0, 1, 1);
    expect(body(c)).toBe(
      '<defs><clipPath id="c1"><path d="M0 0L50 0L50 50L0 50Z"/></clipPath></defs>' +
        '<g clip-path="url(#c1)"><rect x="10" y="10" width="100" height="5" fill="#000000"/></g>' +
        '<rect x="0" y="0" width="1" height="1" fill="#111111"/>',
    );
  });

  it('recortes anidados = grupos anidados, con la matriz vigente al recortar; los vacíos no se escriben', () => {
    const c = make();
    c.save();
    c.translate(10, 20);
    c.beginPath();
    c.rect(0, 0, 40, 40);
    c.clip();
    c.save();
    c.beginPath();
    c.rect(5, 5, 10, 10);
    c.clip();
    c.fillStyle = '#ff0000';
    c.fillRect(0, 0, 30, 30);
    c.restore();
    c.save(); // recorte sin nada adentro
    c.beginPath();
    c.rect(0, 0, 1, 1);
    c.clip();
    c.restore();
    c.restore();
    expect(body(c)).toBe(
      '<defs>' +
        '<clipPath id="c1"><path d="M0 0L40 0L40 40L0 40Z" transform="matrix(1 0 0 1 10 20)"/></clipPath>' +
        '<clipPath id="c2"><path d="M5 5L15 5L15 15L5 15Z" transform="matrix(1 0 0 1 10 20)"/></clipPath>' +
        '</defs>' +
        '<g clip-path="url(#c1)"><g clip-path="url(#c2)"><rect x="0" y="0" width="30" height="30" fill="#ff0000" transform="matrix(1 0 0 1 10 20)"/></g></g>',
    );
  });

  it('restore() devuelve estilo y matriz; restore() de más no rompe', () => {
    const c = make();
    c.save();
    c.translate(3, 4);
    c.fillStyle = '#ff0000';
    c.restore();
    c.restore();
    c.fillRect(0, 0, 1, 1);
    expect(body(c)).toBe('<rect x="0" y="0" width="1" height="1" fill="#000000"/>');
  });
});

describe('texto', () => {
  it('fuente de los tokens, alineación, línea de base y escape XML', () => {
    const c = make();
    c.font = '600 11px "Segoe UI", sans-serif';
    c.fillStyle = '#15181d';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('Hola & <chau>', 50, 25);
    expect(body(c)).toBe('<text x="50" y="25" dy="0.35em" font-family="&quot;Segoe UI&quot;, sans-serif" font-size="11" font-weight="600" text-anchor="middle" fill="#15181d">Hola &amp; &lt;chau&gt;</text>');
  });

  it('texto girado (títulos de eje) lleva la matriz; derecha y arriba se traducen a text-anchor y dy', () => {
    const c = make();
    c.font = '11px sans-serif';
    c.textAlign = 'right';
    c.textBaseline = 'top';
    c.translate(14, 20);
    c.rotate(-Math.PI / 2);
    c.fillText('Porosidad φ (v/v)', 0, 0);
    expect(body(c)).toBe('<text x="0" y="0" dy="0.85em" font-family="sans-serif" font-size="11" text-anchor="end" fill="#000000" transform="matrix(0 -1 1 0 14 20)">Porosidad φ (v/v)</text>');
  });

  it('measureText usa el medidor inyectado con la fuente vigente (y uno aproximado por defecto)', () => {
    const calls: string[] = [];
    const c = new SvgContext2D({ width: 10, height: 10, measure: (f, t) => (calls.push(`${f}|${t}`), t.length * 5) });
    c.font = '10px sans-serif';
    expect(c.measureText('abcd').width).toBe(20);
    expect(calls).toEqual(['10px sans-serif|abcd']);
    expect(approximateMeasure('10px sans-serif', 'iiii')).toBeLessThan(approximateMeasure('10px sans-serif', 'MMMM'));
    expect(approximateMeasure('600 10px sans-serif', 'abc')).toBeGreaterThan(approximateMeasure('400 10px sans-serif', 'abc'));
  });

  it('parseFont entiende peso, tamaño y familia con comas', () => {
    expect(parseFont('500 11px "Segoe UI", Arial, sans-serif')).toEqual({ style: '', weight: '500', size: 11, family: '"Segoe UI", Arial, sans-serif' });
    expect(parseFont('italic bold 12.5px serif')).toEqual({ style: 'italic', weight: '700', size: 12.5, family: 'serif' });
    expect(parseFont('basura').size).toBe(10);
  });

  it('un texto vacío o con posición inválida no emite nada', () => {
    const c = make();
    c.fillText('', 1, 1);
    c.fillText('a', NaN, 1);
    expect(body(c)).toBe('');
  });
});

describe('degradado', () => {
  it('createLinearGradient → linearGradient en defs con paradas y opacidad', () => {
    const c = make();
    const g = c.createLinearGradient(0, 0, 0, 50);
    g.addColorStop(0, 'rgba(94, 100, 230, 0)');
    g.addColorStop(1, 'rgba(94, 100, 230, 0.14)');
    c.fillStyle = g;
    c.fillRect(0, 20, 50, 28);
    c.fillRect(50, 20, 50, 28); // el mismo degradado no se define dos veces
    expect(body(c)).toBe(
      '<defs><linearGradient id="g1" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="50">' +
        '<stop offset="0%" stop-color="#5e64e6" stop-opacity="0"/><stop offset="100%" stop-color="#5e64e6" stop-opacity="0.14"/></linearGradient></defs>' +
        '<rect x="0" y="20" width="50" height="28" fill="url(#g1)"/><rect x="50" y="20" width="50" height="28" fill="url(#g1)"/>',
    );
  });

  it('una parada fuera de [0, 1] es un error', () => {
    expect(() => make().createLinearGradient(0, 0, 1, 1).addColorStop(1.5, '#fff')).toThrow(/entre 0 y 1/);
  });
});

describe('documento', () => {
  it('clearRect de todo el lienzo vacía el dibujo; un clearRect parcial se ignora', () => {
    const c = make();
    c.fillRect(0, 0, 5, 5);
    c.clearRect(0, 0, 10, 10);
    expect(body(c)).toContain('<rect');
    c.clearRect(0, 0, 100, 50);
    expect(body(c)).toBe('');
  });

  it('título y descripción accesibles, con escape', () => {
    const c = new SvgContext2D({ width: 10, height: 10, title: 'Perfil <A>', description: 'a & b' });
    const svg = c.toSvg();
    checkXml(svg);
    expect(svg).toContain('<title>Perfil &lt;A&gt;</title><desc>a &amp; b</desc>');
  });

  it('las operaciones que no existen fallan en voz alta y pintar un Path2D nativo/ajeno es un error claro', () => {
    const c = make() as unknown as Record<string, unknown>;
    expect(c['drawImage']).toBeUndefined();
    expect(c['strokeText']).toBeUndefined();
    expect(() => make().fill({} as never)).toThrow(/Path2D/);
  });

  it('withSvgPath2D reemplaza Path2D solo durante la llamada y lo restaura aunque falle', () => {
    const g = globalThis as { Path2D?: unknown };
    const before = g.Path2D;
    let inside: unknown;
    withSvgPath2D(() => {
      inside = g.Path2D;
      expect(new (g.Path2D as typeof SvgPath2D)()).toBeInstanceOf(SvgPath2D);
    });
    expect(inside).toBe(SvgPath2D);
    expect(g.Path2D).toBe(before);
    expect(() =>
      withSvgPath2D(() => {
        throw new Error('x');
      }),
    ).toThrow('x');
    expect(g.Path2D).toBe(before);
    expect('Path2D' in g).toBe(before !== undefined);
  });

  it('un dibujo mixto es XML bien formado, sin NaN ni undefined', () => {
    const c = make();
    c.save();
    c.beginPath();
    c.rect(0, 0, 60, 40);
    c.clip();
    c.fillStyle = 'rgba(200, 100, 0, 0.3)';
    c.beginPath();
    c.roundRect(2, 2, 30, 20, 5);
    c.fill();
    c.strokeStyle = '#3366cc';
    c.setLineDash([2, 2]);
    c.beginPath();
    c.arc(30, 20, 8, 0, 2 * Math.PI);
    c.moveTo(NaN, 3);
    c.stroke();
    c.restore();
    c.fillStyle = '#000';
    c.font = '11px sans-serif';
    c.fillText('φ = 0,2', 4, 45);
    const svg = c.toSvg('#fff');
    const rep = checkXml(svg);
    expect(rep.root).toBe('svg');
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    expect([...rep.counts.keys()].sort()).toEqual(['clipPath', 'defs', 'g', 'path', 'rect', 'svg', 'text']);
  });
});

describe('colores CSS', () => {
  it('hex corto y largo, con alfa, rgb() y rgba() con comas, espacios o porcentajes', () => {
    expect(parseCssColor('#abc')).toEqual({ hex: '#aabbcc', alpha: 1 });
    expect(parseCssColor('#112233')).toEqual({ hex: '#112233', alpha: 1 });
    expect(parseCssColor('#11223380')?.alpha).toBeCloseTo(0.502, 2);
    expect(parseCssColor('rgb(255, 0, 10)')).toEqual({ hex: '#ff000a', alpha: 1 });
    expect(parseCssColor('rgba(79, 85, 216, 0.12)')).toEqual({ hex: '#4f55d8', alpha: 0.12 });
    expect(parseCssColor('rgb(0 128 255 / 50%)')).toEqual({ hex: '#0080ff', alpha: 0.5 });
    expect(parseCssColor('transparent')?.alpha).toBe(0);
    expect(parseCssColor('rebeccapurple')).toBeNull();
    expect(parseCssColor('#12')).toBeNull();
  });
});
