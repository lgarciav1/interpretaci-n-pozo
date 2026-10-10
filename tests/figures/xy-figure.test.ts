/** Figura de un gráfico x–y (src/plots/xy/figure.ts) y registro de gráficos exportables (figures.ts). */
import { afterEach, describe, expect, it } from 'vitest';
import { SvgContext2D, approximateMeasure, templateById, withSvgPath2D } from '../../src/io/export/figures';
import { drawXYFigure, layoutXYFigure, xyLegendEntries, type XYFigureInput } from '../../src/plots/xy/figure';
import { getXYFigure, listXYFigures, registerXYFigure, subscribeXYFigures, type XYFigureSource } from '../../src/plots/xy/figures';
import { fitTrend } from '../../src/petro/regression';
import { checkXml } from './xml';

const phi = [0.05, 0.08, 0.11, 0.14, 0.17, 0.2];
const k = phi.map((p) => 0.02 * Math.exp(50 * p));

const source = (): XYFigureSource => ({
  id: 'kphi',
  title: 'Crossplot k–φ de los plugs',
  x: { kind: 'linear', min: 0, max: 0.3, label: 'Porosidad φ', unit: 'v/v' },
  y: { kind: 'log', min: 0.01, max: 10000, label: 'Permeabilidad k', unit: 'mD' },
  points: [
    { id: 'plugs', name: 'Plugs de corona', x: phi, y: k, color: '#a21caf', radius: 4.5 },
    { id: 'cloud', x: phi, y: k, color: '#888888', cloud: true },
  ],
  lines: [{ id: 'r', name: 'Modelo regional', x: [0, 0.3], y: [0.05, 100], color: '#3366cc', dash: [4, 3] }],
  trends: [{ id: 't1', name: 'Exponencial', coeffs: fitTrend(phi, k, 'exp')!, span: [0.05, 0.2], color: '#1d4ed8', extend: true, label: ['k = 0,02·e^(50·φ)', 'R² 1,00 · n 6'] }],
  guides: [{ axis: 'x', value: 0.1, color: '#d97706' }],
});

const inputOf = (over: Partial<XYFigureInput> = {}): XYFigureInput => {
  const t = templateById('crossplot-legend');
  return { source: source(), parts: t.parts, title: 'Crossplot k–φ de los plugs', subtitle: 'Pozo X', credits: 'Pozo X · 10/10/2026', margin: 22, width: 530, height: 416, measure: approximateMeasure, ...over };
};

function toSvg(input: XYFigureInput) {
  const layout = layoutXYFigure(input);
  const c = new SvgContext2D({ width: layout.width, height: layout.height, measure: input.measure });
  withSvgPath2D(() => drawXYFigure(c.asCanvas(), input, layout));
  const svg = c.toSvg('#ffffff');
  return { svg, layout, rep: checkXml(svg) };
}

describe('leyenda', () => {
  it('capas con nombre y tendencias con su ecuación y R²; sin nombre no figura', () => {
    expect(xyLegendEntries(source())).toEqual([
      { kind: 'point', color: '#a21caf', text: 'Plugs de corona' },
      { kind: 'line', color: '#3366cc', text: 'Modelo regional', dash: [4, 3] },
      { kind: 'trend', color: '#1d4ed8', text: 'Exponencial: k = 0,02·e^(50·φ) · R² 1,00 · n 6' },
    ]);
  });
});

describe('figura a SVG', () => {
  it('es XML válido, con ejes rotulados con unidad, puntos, tendencia, leyenda y créditos', () => {
    const { svg, layout, rep } = toSvg(inputOf());
    expect(rep.root).toBe('svg');
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    const texts = rep.elements.filter((e) => e.name === 'text').map((e) => e.text);
    for (const t of ['Crossplot k–φ de los plugs', 'Pozo X', 'Porosidad φ (v/v)', 'Permeabilidad k (mD)', 'Plugs de corona', 'Modelo regional', 'Pozo X · 10/10/2026']) expect(texts, t).toContain(t);
    expect(texts.some((t) => t.startsWith('Exponencial: k = 0,02·e^(50·φ)'))).toBe(true);
    // puntos llenos (6 plugs + 1 de leyenda) como arcos; el eje y log tiene rótulos por década
    expect((svg.match(/A4\.5 4\.5/g) ?? []).length).toBeGreaterThanOrEqual(12);
    expect(texts).toEqual(expect.arrayContaining(['0,05', '0,30', '0,01', '1', '100', '10.000'])); // ticks lineales y por década (log)
    // el título del eje y va girado
    expect(rep.elements.some((e) => e.name === 'text' && e.attrs['transform']?.startsWith('matrix(0 -1 1 0') && e.text.startsWith('Permeabilidad'))).toBe(true);
    // tema claro: fondo blanco
    expect(svg).toContain(`<rect width="${layout.width}" height="${layout.height}" fill="#ffffff"/>`);
  });

  it('con barra de color (tercera curva) escribe un degradado con sus extremos', () => {
    const { svg, rep } = toSvg(inputOf({ colorKey: { title: 'GR', unit: 'gAPI', min: 20, max: 150, colors: ['#2563eb', '#fde047', '#dc2626'] } }));
    expect(rep.counts.get('linearGradient')).toBe(1);
    expect(rep.counts.get('stop')).toBe(3);
    expect(svg).toContain('stop-color="#fde047"');
    const texts = rep.elements.filter((e) => e.name === 'text').map((e) => e.text);
    expect(texts).toEqual(expect.arrayContaining(['GR (gAPI)', '20', '150']));
  });

  it('el alto del gráfico es lo que queda después de título, leyenda y pie; el tamaño total respeta el pedido', () => {
    const a = layoutXYFigure(inputOf());
    expect(a.plot.y).toBeGreaterThan(22 + 40);
    expect(a.plot.x).toBe(22);
    expect(a.plot.width).toBe(530 - 44);
    expect(Math.abs(a.height - 416)).toBeLessThanOrEqual(2);
    const sinLeyenda = layoutXYFigure(inputOf({ parts: { ...templateById('crossplot-legend').parts, legend: false } }));
    expect(sinLeyenda.plot.height).toBeGreaterThan(a.plot.height);
  });

  it('un eje inválido deja un aviso en vez de romper', () => {
    const bad = source();
    bad.y = { ...bad.y, min: 0 }; // log con mínimo 0
    const { rep } = toSvg(inputOf({ source: bad }));
    expect(rep.elements.some((e) => e.text === 'Los ejes del gráfico no son válidos.')).toBe(true);
  });
});

describe('registro de gráficos exportables', () => {
  const offs: (() => void)[] = [];
  afterEach(() => offs.splice(0).forEach((f) => f()));

  it('un gráfico montado se publica y se retira al desmontarse; avisa a quien escucha', () => {
    let calls = 0;
    offs.push(subscribeXYFigures(() => calls++));
    expect(listXYFigures()).toEqual([]);
    const off = registerXYFigure(source());
    expect(calls).toBe(1);
    expect(listXYFigures().map((f) => f.id)).toEqual(['kphi']);
    expect(getXYFigure('kphi')?.title).toBe('Crossplot k–φ de los plugs');
    off();
    expect(calls).toBe(2);
    expect(listXYFigures()).toEqual([]);
  });

  it('actualizar reemplaza; la baja de una publicación vieja no borra la nueva (remontaje)', () => {
    const offOld = registerXYFigure(source());
    const offNew = registerXYFigure({ ...source(), title: 'nuevo' });
    offs.push(offNew);
    offOld();
    expect(getXYFigure('kphi')?.title).toBe('nuevo');
    expect(listXYFigures()).toHaveLength(1);
  });

  it('la lista es la misma referencia mientras no cambie nada (useSyncExternalStore)', () => {
    offs.push(registerXYFigure(source()));
    expect(listXYFigures()).toBe(listXYFigures());
  });
});
