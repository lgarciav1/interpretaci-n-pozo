import { describe, expect, it } from 'vitest';
import { BUILTIN_ROLES } from '../../src/core/roles';
import { sameDimension } from '../../src/core/units';
import { normalizeMnemonic, suggestRole } from '../../src/io';

describe('suggestRole', () => {
  it.each([
    ['GR', 'GR'], ['GRC', 'GR'], ['SGR', 'GR'], ['CGR', 'CGR'],
    ['RHOB', 'RHOB'], ['RHOZ', 'RHOB'], ['ZDEN', 'RHOB'], ['DEN', 'RHOB'],
    ['NPHI', 'NPHI'], ['NPOR', 'NPHI'], ['TNPH', 'NPHI'], ['CNL', 'NPHI'],
    ['DT', 'DT'], ['DTC', 'DT'], ['AC', 'DT'],
    ['PE', 'PEF'], ['PEF', 'PEF'], ['PEFZ', 'PEF'],
    ['CALI', 'CALI'], ['CAL', 'CALI'], ['HCAL', 'CALI'], ['BS', 'BS'], ['SP', 'SP'],
    ['RT', 'RT'], ['AT90', 'RT'], ['ILD', 'RT'], ['LLD', 'RT'], ['RDEP', 'RT'],
    ['RM', 'RM'], ['AT60', 'RM'], ['ILM', 'RM'],
    ['RS', 'RS'], ['SFL', 'RS'], ['MSFL', 'RXO'], ['RXO', 'RXO'],
    ['URAN', 'URAN'], ['THOR', 'THOR'], ['POTA', 'POTA'],
    ['PHIT_CMR', 'PHIT_NMR'], ['PHIE_CMR', 'PHIE_NMR'], ['PHI_BVI', 'BVI_NMR'],
  ])('%s → %s', (mnemonic, role) => {
    expect(suggestRole(mnemonic).role).toBe(role);
  });

  it('la inducción de arreglo somera tiene roles propios (RA10, RA20, RA30) con confianza alta; AT60 sigue siendo RM y AT90 RT', () => {
    for (const [m, role] of [
      ['AT10', 'RA10'], ['AHT10', 'RA10'], ['AF10', 'RA10'], ['M2R1', 'RA10'],
      ['AT20', 'RA20'], ['AHT20', 'RA20'], ['AF20', 'RA20'], ['M2R2', 'RA20'],
      ['AT30', 'RA30'], ['AHT30', 'RA30'], ['AF30', 'RA30'], ['M2R3', 'RA30'],
      ['AT60', 'RM'], ['AT90', 'RT'],
    ] as const) {
      expect(suggestRole(m), m).toMatchObject({ role, unit: 'ohm.m', confidence: 'high' });
    }
  });

  it('el laterolog somero (LLS) es RS con la misma confianza que LLD (RT) y LLM (RM)', () => {
    expect(suggestRole('LLS')).toEqual({ role: 'RS', unit: 'ohm.m', confidence: 'high' });
    expect(suggestRole('LLS').confidence).toBe(suggestRole('LLD').confidence);
    expect(suggestRole('LLS').confidence).toBe(suggestRole('LLM').confidence);
    expect(suggestRole('lls:1').role).toBe('RS');
  });

  it('normaliza mayúsculas, espacios y sufijos :1', () => {
    expect(normalizeMnemonic('  gr:1 ')).toBe('GR');
    expect(normalizeMnemonic('phi bvi')).toBe('PHI_BVI');
    expect(suggestRole(' rhoz:2 ').role).toBe('RHOB');
    expect(suggestRole('Zden').role).toBe('RHOB');
  });

  it('interpreta unidades del archivo', () => {
    expect(suggestRole('DT', 'µs/ft').unit).toBe('us/ft');
    expect(suggestRole('DT', 'μs/ft').unit).toBe('us/ft');
    expect(suggestRole('DT', 'US/M').unit).toBe('us/m');
    expect(suggestRole('RT', 'ohmm').unit).toBe('ohm.m');
    expect(suggestRole('RHOB', 'g/cc').unit).toBe('g/cm3');
    expect(suggestRole('RHOB', 'kg/m3').unit).toBe('kg/m3');
    expect(suggestRole('NPHI', '%')).toMatchObject({ role: 'NPHI', unit: '%' });
    expect(suggestRole('NPHI', 'PU').unit).toBe('%');
    expect(suggestRole('POTA', '%').unit).toBe('wt%');
    expect(suggestRole('GR', 'GAPI').unit).toBe('gAPI');
    expect(suggestRole('CAL', 'IN').unit).toBe('in');
    expect(suggestRole('CAL', 'mm').unit).toBe('mm');
    expect(suggestRole('TEMP', 'F').unit).toBe('degF');
  });

  it('sin unidad en el archivo o con unidad desconocida usa la usual del mnemónico', () => {
    expect(suggestRole('GR')).toEqual({ role: 'GR', unit: 'gAPI', confidence: 'high' });
    expect(suggestRole('GR', 'cps').unit).toBe('gAPI');
  });

  it('una unidad de otra magnitud anula el rol; mnemónico desconocido no sugiere nada', () => {
    expect(suggestRole('GR', 'ohmm')).toMatchObject({ role: null, confidence: 'none' });
    expect(suggestRole('XYZ', 'ft')).toEqual({ role: null, unit: 'ft', confidence: 'none' });
  });

  it('la confianza baja para mnemónicos ambiguos', () => {
    expect(suggestRole('AT90').confidence).toBe('high');
    expect(suggestRole('DEN').confidence).toBe('medium');
    expect(suggestRole('XYZ').confidence).toBe('none');
  });

  it('todo rol sugerido existe y su unidad es compatible con la canónica', () => {
    const roles = new Map(BUILTIN_ROLES.map((r) => [r.id, r.unit]));
    for (const m of ['GR', 'CGR', 'SGR', 'RHOB', 'DRHO', 'NPHI', 'DT', 'DTS', 'PEF', 'PE', 'CAL', 'BS', 'SP', 'RT', 'RM', 'RS', 'RXO',
      'URAN', 'THOR', 'POTA', 'PHIT_CMR', 'PHIE_CMR', 'PHI_BVI', 'TEMP']) {
      const s = suggestRole(m);
      expect(roles.has(s.role!), m).toBe(true);
      expect(sameDimension(s.unit!, roles.get(s.role!)!), m).toBe(true);
    }
  });
});
