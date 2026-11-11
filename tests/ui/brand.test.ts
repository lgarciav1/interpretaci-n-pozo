import { describe, expect, it } from 'vitest';
import { BRAND_TRACE_COMPACT, BRAND_TRACE_DETAIL, brandMarkSvg, brandStroke } from '../../src/ui/brandSvg';
import { BASE_TOKENS } from '../../src/ui/tokens';

describe('marca (0070)', () => {
  it('compacta hasta 39 px, detallada desde 40 (con grilla de papel de perfil)', () => {
    const small = brandMarkSvg({ size: 22 });
    const big = brandMarkSvg({ size: 48 });
    expect(small).toContain(BRAND_TRACE_COMPACT);
    expect(small).not.toContain('M5 0V64');
    expect(big).toContain(BRAND_TRACE_DETAIL);
    expect(big).toContain('M5 0V64');
    expect(brandMarkSvg({ size: 22, detail: 'full' })).toContain(BRAND_TRACE_DETAIL);
  });

  it('las trazas recorren el cuadro de arriba (y = 0) a abajo (y = 64)', () => {
    for (const t of [BRAND_TRACE_COMPACT, BRAND_TRACE_DETAIL]) {
      expect(t.startsWith('M37 0 ')).toBe(true);
      expect(t.endsWith(' 64')).toBe(true);
    }
  });

  it('gradiente térmico de los tokens, ids con prefijo y sin recursos externos', () => {
    const svg = brandMarkSvg({ size: 40, idPrefix: 'x' });
    expect(svg).toContain(`stop-color="${BASE_TOKENS.brand.thermal1}"`);
    expect(svg).toContain(`stop-color="${BASE_TOKENS.brand.thermal4}"`);
    expect(svg).toContain('id="x-heat"');
    expect(svg).toContain('url(#x-heat)');
    expect(svg).not.toMatch(/(?:src|href)="https?:/);
  });

  it('decorativa por defecto; con título se anuncia (y el título se sanea)', () => {
    expect(brandMarkSvg()).toContain('aria-hidden="true"');
    expect(brandMarkSvg({ title: 'fiuba<Log>"' })).toContain('role="img" aria-label="fiubaLog"');
  });

  it('el trazo se afina con el tamaño', () => {
    expect(brandStroke(false, 16)).toBeGreaterThan(brandStroke(false, 32));
    expect(brandStroke(true, 48)).toBeGreaterThan(brandStroke(true, 120));
  });
});
