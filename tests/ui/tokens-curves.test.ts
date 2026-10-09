import { describe, expect, it } from 'vitest';
import { BUILTIN_ROLES, RoleCatalog } from '../../src/core/roles';
import { contrastRatio, ensureContrast, luminance, mix, parseHex } from '../../src/ui/color';
import { CATEGORICAL, CURVE_PALETTE, curveStyle, dashPattern, FILL_PALETTE, ZONE_PALETTE } from '../../src/ui/curves';
import { computePosition } from '../../src/ui/components/layer';
import { resolveTheme } from '../../src/ui/theme';
import { BASE_TOKENS, THEMES, cssVarName, definedCssVars, tokensToCss } from '../../src/ui/tokens';

const CSS_FILES = import.meta.glob('../../src/**/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const HEX = /^#[0-9a-f]{6}$/i;

describe('tokens', () => {
  it('claro y oscuro definen exactamente las mismas claves', () => {
    const keys = (t: (typeof THEMES)['light']) => ({ color: Object.keys(t.color).sort(), shadow: Object.keys(t.shadow).sort(), viewer: Object.keys(t.viewer).sort() });
    expect(keys(THEMES.dark)).toEqual(keys(THEMES.light));
  });

  it('genera variables CSS con unidades y nombres en kebab-case', () => {
    const css = tokensToCss();
    expect(cssVarName('color', 'textMuted')).toBe('--color-text-muted');
    expect(css).toContain('--space-4: 16px;');
    expect(css).toContain('--text-md: 13px;');
    expect(css).toContain('--dur-fast: 120ms;');
    expect(css).toContain('--weight-semibold: 600;');
    expect(css).toContain('--space-0: 0;');
    expect(css).toContain(`--viewer-track-bg: ${THEMES.dark.viewer.trackBg};`);
    expect(css).toMatch(/\[data-theme="dark"\] \{[^}]*color-scheme: dark;/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*--dur-base: 0ms;/);
  });

  it('todo var(--x) usado en los CSS de src existe (tokens o declarado en el mismo CSS)', () => {
    const defined = definedCssVars();
    const all = Object.values(CSS_FILES).join('\n');
    for (const m of all.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]!);
    // Variables que se fijan desde TSX con style={{ '--x': … }}.
    for (const v of ['--ui-slider-fill', '--mark-t', '--shell-left', '--shell-right', '--shell-dock']) defined.add(v);
    const missing = new Set<string>();
    for (const [file, css] of Object.entries(CSS_FILES)) {
      for (const m of css.matchAll(/var\((--[a-z0-9-]+)/g)) if (!defined.has(m[1]!)) missing.add(`${file}: ${m[1]}`);
    }
    expect([...missing]).toEqual([]);
    expect(Object.keys(CSS_FILES).length).toBeGreaterThan(8);
  });

  it('contraste de texto: principal ≥ 7, secundario ≥ 4,5 y acento como texto ≥ 4,5 en ambos temas', () => {
    for (const t of Object.values(THEMES)) {
      expect(contrastRatio(t.color.text, t.color.surface), t.name).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(t.color.textMuted, t.color.surface), t.name).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.color.textMuted, t.color.bg), t.name).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.color.accentText, t.color.surface), t.name).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.color.textOnAccent, t.color.accent), t.name).toBeGreaterThanOrEqual(4.5);
      for (const k of ['okText', 'warnText', 'errorText', 'infoText'] as const) expect(contrastRatio(t.color[k], t.color.surface), `${t.name} ${k}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('el tema resuelto sigue al sistema solo con la preferencia "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('las escalas base son crecientes', () => {
    const inc = (o: Record<string, number>) => Object.values(o).every((v, i, a) => i === 0 || v > a[i - 1]!);
    expect(inc(BASE_TOKENS.text)).toBe(true);
    expect(inc(BASE_TOKENS.z)).toBe(true);
    // Espaciado: la clave es el múltiplo de 4 px ('2-5' = 2,5 × 4 = 10 px).
    for (const [k, v] of Object.entries(BASE_TOKENS.space)) expect(v, k).toBe(Number(k.replace('-', '.')) * 4);
  });
});

describe('color', () => {
  it('contraste WCAG de referencia', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(luminance('#fff')).toBe(1);
    expect(parseHex('#0a0B0c')).toEqual([10, 11, 12]);
    expect(() => parseHex('rojo')).toThrow();
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('ensureContrast aclara sobre fondo oscuro y oscurece sobre fondo claro', () => {
    const dark = ensureContrast('#333333', '#111316', 3);
    expect(contrastRatio(dark, '#111316')).toBeGreaterThanOrEqual(3);
    const light = ensureContrast('#ffee88', '#ffffff', 3);
    expect(contrastRatio(light, '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(ensureContrast('#d1242f', '#ffffff', 3)).toBe('#d1242f');
  });
});

describe('paleta de curvas', () => {
  it('cubre todos los roles incorporados', () => {
    for (const r of BUILTIN_ROLES) expect(CURVE_PALETTE[r.id], r.id).toBeDefined();
  });

  it('toda curva de línea contrasta ≥ 3:1 con el fondo de pista en su tema', () => {
    for (const [role, e] of Object.entries(CURVE_PALETTE)) {
      if (e.kind === 'band') continue;
      for (const theme of ['light', 'dark'] as const) {
        expect(e[theme], role).toMatch(HEX);
        expect(contrastRatio(e[theme], THEMES[theme].viewer.trackBg), `${role} ${theme}`).toBeGreaterThanOrEqual(3);
      }
    }
    for (const theme of ['light', 'dark'] as const) {
      for (const c of CATEGORICAL[theme]) expect(contrastRatio(c, THEMES[theme].viewer.trackBg), `${c} ${theme}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('convenciones de la industria: GR verde continuo, Rt roja continua en log, NPHI azul rayada e invertida', () => {
    const gr = curveStyle('GR', 'light');
    expect(gr.line).toBe('solid');
    const [r, g, b] = parseHex(gr.color);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    const rt = curveStyle('RT', 'dark');
    expect(rt.scale).toBe('log');
    expect(rt.line).toBe('solid');
    expect(parseHex(rt.color)[0]).toBeGreaterThan(200);
    const nphi = curveStyle('NPHI', 'light');
    expect(nphi.line).toBe('dashed');
    expect(nphi.dash.length).toBe(2);
    expect(nphi.reversed).toBe(true);
    const [nr, , nb] = parseHex(nphi.color);
    expect(nb).toBeGreaterThan(nr);
    expect(curveStyle('PERM', 'light').scale).toBe('log');
  });

  it('roles de módulos sin paleta: usan su display.color con contraste garantizado; sin color, uno categórico estable', () => {
    const catalog = new RoleCatalog([
      ...BUILTIN_ROLES,
      { id: 'MY_DARK', label: 'Mi curva', unit: 'unitless', family: 'other', origin: 'computed', display: { color: '#202020', scale: 'linear', min: 0, max: 1 } },
      { id: 'MY_PLAIN', label: 'Sin color', unit: 'unitless', family: 'other', origin: 'computed' },
    ]);
    const s = curveStyle('MY_DARK', 'dark', catalog);
    expect(contrastRatio(s.color, THEMES.dark.viewer.trackBg)).toBeGreaterThanOrEqual(3);
    expect(s.min).toBe(0);
    expect(curveStyle('MY_DARK', 'light', catalog).color).toBe('#202020');
    const a = curveStyle('MY_PLAIN', 'light', catalog);
    expect(CATEGORICAL.light).toContain(a.color);
    expect(curveStyle('MY_PLAIN', 'light', catalog).color).toBe(a.color);
    expect(curveStyle(null, 'dark', catalog, 'AT10').label).toBe('AT10');
  });

  it('patrones de trazo escalan con el grosor', () => {
    expect(dashPattern('solid')).toEqual([]);
    expect(dashPattern('dashed', 2.5)[0]).toBeGreaterThan(dashPattern('dashed', 1)[0]!);
    expect(dashPattern('dashdot')).toHaveLength(4);
  });

  it('rellenos y zonas tienen colores válidos en ambos temas', () => {
    for (const f of Object.values(FILL_PALETTE)) {
      expect(f.light).toMatch(HEX);
      expect(f.dark).toMatch(HEX);
      expect(f.alpha).toBeGreaterThan(0);
      expect(f.alpha).toBeLessThanOrEqual(1);
    }
    for (const z of ZONE_PALETTE) expect(z).toMatch(HEX);
  });
});

describe('posicionamiento de capas flotantes', () => {
  const vp = { width: 1000, height: 800 };
  const anchor = { top: 100, bottom: 130, left: 400, right: 480, width: 80, height: 30 } as DOMRect;
  it('ubica abajo centrado y gira arriba si no entra', () => {
    expect(computePosition(anchor, { width: 120, height: 40 }, 'bottom', 'center', 6, vp)).toEqual({ top: 136, left: 380, placement: 'bottom' });
    const low = { ...anchor, top: 760, bottom: 790 } as DOMRect;
    expect(computePosition(low, { width: 120, height: 40 }, 'bottom', 'center', 6, vp).placement).toBe('top');
  });
  it('alinea al final y no se sale de la ventana', () => {
    expect(computePosition(anchor, { width: 200, height: 40 }, 'bottom', 'end', 6, vp).left).toBe(280);
    const edge = { ...anchor, left: 960, right: 990 } as DOMRect;
    expect(computePosition(edge, { width: 200, height: 40 }, 'bottom', 'start', 6, vp).left).toBe(792);
  });
});
