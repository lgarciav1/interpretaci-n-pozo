/** Tamaño de interfaz (docs/decisiones/0013-tamano-de-interfaz.md): niveles, tokens escalados, preferencia y armazón. */
import { afterEach, describe, expect, it } from 'vitest';
import { AUTO_CAP, shellSize, shellSizeCss, type ShellLayout } from '../../src/app/store/ui';
import { BASE_TOKENS, canvasFont, definedCssVars, scalePx, scaledTokens, tokensToCss, uiScaleFactor, UI_SCALES } from '../../src/ui/tokens';
import { DEFAULT_UI_SCALE, getUiScale, getUiScaleFactor, isUiScale, resolveUiScale, scaledCss, setUiScale, subscribeUiScale, uiPx } from '../../src/ui/uiScale';

const CSS_FILES = import.meta.glob('../../src/**/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

afterEach(() => setUiScale(DEFAULT_UI_SCALE));

describe('niveles', () => {
  it('Compacto es la densidad original (factor 1); Normal es el valor por defecto y Grande el mayor', () => {
    expect(UI_SCALES.map((s) => s.id)).toEqual(['compact', 'normal', 'large']);
    expect(UI_SCALES.map((s) => s.label)).toEqual(['Compacto', 'Normal', 'Grande']);
    expect(uiScaleFactor('compact')).toBe(1);
    expect(DEFAULT_UI_SCALE).toBe('normal');
    const f = UI_SCALES.map((s) => s.factor);
    expect([...f].sort((a, b) => a - b)).toEqual(f);
    expect(new Set(f).size).toBe(3);
  });

  it('resuelve lo guardado: un nivel válido pasa; cualquier otra cosa (o nada) → Normal', () => {
    expect(resolveUiScale('compact')).toBe('compact');
    expect(resolveUiScale('large')).toBe('large');
    for (const v of [null, undefined, '', 'grande', 'NORMAL', 1.25, {}]) expect(resolveUiScale(v)).toBe('normal');
    expect(isUiScale('normal')).toBe(true);
    expect(isUiScale('huge')).toBe(false);
  });
});

describe('tokens escalados', () => {
  it('Compacto reproduce BASE_TOKENS exactamente', () => {
    const t = scaledTokens('compact');
    expect(t.text).toEqual(BASE_TOKENS.text);
    expect(t.space).toEqual(BASE_TOKENS.space);
    expect(t.size).toEqual(BASE_TOKENS.size);
  });

  it('Normal lleva el texto base a 14–15 px y Grande a más; todo en px enteros y en el mismo orden', () => {
    const n = scaledTokens('normal');
    const g = scaledTokens('large');
    expect(n.text.md).toBeGreaterThanOrEqual(14);
    expect(n.text.md).toBeLessThanOrEqual(15);
    expect(g.text.md).toBeGreaterThan(n.text.md);
    for (const t of [n, g]) {
      for (const group of [t.text, t.space, t.size]) for (const v of Object.values(group)) expect(Number.isInteger(v)).toBe(true);
      const text = Object.values(t.text);
      expect([...text].sort((a, b) => a - b)).toEqual(text);
      expect(t.space['0']).toBe(0);
    }
    // Cada medida crece (o queda igual) al pasar de nivel.
    for (const key of Object.keys(BASE_TOKENS.size) as (keyof typeof BASE_TOKENS.size)[]) {
      expect(n.size[key]).toBeGreaterThanOrEqual(BASE_TOKENS.size[key]);
      expect(g.size[key]).toBeGreaterThanOrEqual(n.size[key]);
    }
  });

  it('scalePx: 0 y factor 1 no cambian nada (ni fracciones); los demás redondean a px enteros', () => {
    expect(scalePx(0, 1.25)).toBe(0);
    expect(scalePx(1.5, 1)).toBe(1.5);
    expect(scalePx(11, 1.125)).toBe(12);
    expect(scalePx(13, 1.125)).toBe(15);
  });

  it('el CSS generado: base en Compacto con --ui-scale: 1 y un bloque por nivel en <html data-ui-scale>', () => {
    const css = tokensToCss();
    expect(css).toMatch(/:root \{[^}]*--text-md: 13px;[^}]*--ui-scale: 1;/);
    const normal = /:root\[data-ui-scale="normal"\] \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(normal).toContain(`--text-md: ${scaledTokens('normal').text.md}px;`);
    expect(normal).toContain(`--size-topbar: ${scaledTokens('normal').size.topbar}px;`);
    expect(normal).toContain('--space-0: 0;');
    expect(normal).toContain(`--ui-scale: ${uiScaleFactor('normal')};`);
    expect(css).toContain(':root[data-ui-scale="large"]');
    expect(css).not.toContain('data-ui-scale="compact"');
    // Radios, capas y movimiento no escalan.
    expect(normal).not.toMatch(/--radius-|--z-|--dur-/);
    expect(definedCssVars().has('--ui-scale')).toBe(true);
  });

  it('canvasFont con factor 1 da la cadena de siempre; con otro factor, el tamaño escalado', () => {
    expect(canvasFont(11)).toBe(`400 11px ${BASE_TOKENS.font.sans}`);
    expect(canvasFont(11, 600, 1.25)).toBe(`600 14px ${BASE_TOKENS.font.sans}`);
  });

  it('los CSS no fijan tamaños de letra en px: usan los tokens o calc(Npx * var(--ui-scale))', () => {
    const bad: string[] = [];
    for (const [file, css] of Object.entries(CSS_FILES)) {
      for (const m of css.matchAll(/font-size:\s*([^;}]+)/g)) {
        const v = m[1]!;
        if (/\d px/.test(v) || (/\dpx/.test(v) && !/var\(--ui-scale\)/.test(v) && !/var\(--text-/.test(v))) bad.push(`${file}: font-size: ${v}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('preferencia en ejecución', () => {
  it('cambia el nivel, avisa a los suscriptos una sola vez por cambio y funciona sin localStorage', () => {
    const seen: string[] = [];
    const off = subscribeUiScale(() => seen.push(getUiScale()));
    setUiScale('large');
    setUiScale('large');
    expect(getUiScaleFactor()).toBe(uiScaleFactor('large'));
    expect(uiPx(16)).toBe(20);
    setUiScale('compact');
    off();
    setUiScale('normal');
    expect(seen).toEqual(['large', 'compact']);
  });

  it('scaledCss: números en px de Compacto que siguen a --ui-scale; lo demás queda igual', () => {
    expect(scaledCss(260)).toBe('calc(260px * var(--ui-scale, 1))');
    expect(scaledCss(0)).toBe('0');
    expect(scaledCss('50%')).toBe('50%');
  });
});

describe('medidas del armazón', () => {
  const layout: ShellLayout = { leftWidth: 292, rightWidth: 368, leftCollapsed: false, rightCollapsed: false, dockHeight: 260, leftAuto: true, rightAuto: true, dockAuto: true, dockCollapsed: false, wellHeader: true, panels: 'side' };
  const notebook = { width: 1366, height: 768 };

  it('automáticas: la guardada × factor, sin pasar del tope por ventana', () => {
    expect(shellSize('left', layout, 1, { width: 2560, height: 1440 })).toBe(292);
    expect(shellSize('dock', layout, 1.125, { width: 2560, height: 1440 })).toBe(292.5);
    expect(shellSize('right', layout, 1.25, notebook)).toBeCloseTo((1366 * AUTO_CAP.right) / 100);
    expect(shellSize('dock', layout, 1.125, notebook)).toBeCloseTo((768 * AUTO_CAP.dock) / 100);
  });

  it('elegidas por el usuario: exactamente la guardada × factor, sin tope', () => {
    const manual = { ...layout, dockAuto: false, dockHeight: 500 };
    expect(shellSize('dock', manual, 1.25, notebook)).toBe(625);
    expect(shellSizeCss('dock', manual)).toBe('calc(500px * var(--ui-scale, 1))');
    expect(shellSizeCss('left', layout)).toBe(`min(calc(292px * var(--ui-scale, 1)), ${AUTO_CAP.left}vw)`);
  });
});
