/**
 * Fichas técnicas de la sarta (fase 11c): cada número de `TOOL_SHEETS` tiene que coincidir con el bloque JSON de la
 * investigación de la 11b (`docs/investigacion/herramientas-de-perfilaje.md`), los `null` quedar vacíos y los campos
 * sin verificar marcados. Así nadie «completa» una ficha de memoria sin que falle un test.
 */
import { describe, expect, it } from 'vitest';
import { defaultRoleCatalog } from '../src/core/roles';
import { BUILTIN_TOOLS, defaultToolCatalog, sheetOf } from '../src/core/tools';
import { TOOL_SHEETS, validateToolSheet, type ToolSheet } from '../src/core/toolSheets';
import md from '../docs/investigacion/herramientas-de-perfilaje.md?raw';

interface Research {
  id: string;
  roles: string[];
  doiIn: { typical: number | null; min: number | null; max: number | null };
  verticalResolutionIn: number | null;
  lengthM: number | null;
  odIn: number | null;
  mounting: 'pad' | 'eccentralized' | 'centralized' | 'contact' | 'none';
  shells: { role: string; doiIn: number }[];
  unverified: string[];
  sources: string[];
  measures: string;
  limitations: string;
}

const json = md.slice(md.lastIndexOf('```json') + 7, md.lastIndexOf('```'));
const research = JSON.parse(json) as Research[];

/** Ids de la investigación → ids de la app (encabezado de `toolSheets.ts`). Sin herramienta: piezas del dibujo y el multibrazo. */
const APP_ID: Record<string, string | null> = {
  gr: 'gr',
  'gr-spectral': 'spectral-gr',
  sp: 'sp',
  'caliper-pad': 'caliper',
  'caliper-multiarm': null,
  density: 'density',
  neutron: 'neutron',
  sonic: 'sonic',
  dll: 'laterolog',
  'induction-array': 'induction',
  msfl: 'microresistivity',
  nmr: 'nmr',
  head: null,
  centralizer: null,
};

const FIELD: Record<string, keyof ToolSheet> = { doiIn: 'investigation', verticalResolutionIn: 'verticalResolution', lengthM: 'length', odIn: 'diameter', mounting: 'mounting' };

describe('fichas técnicas volcadas de la investigación (11b)', () => {
  it('todas validan y cada herramienta de la investigación tiene su ficha', () => {
    for (const [id, s] of Object.entries(TOOL_SHEETS)) expect(validateToolSheet(id, s)).toEqual([]);
    for (const r of research) expect(r.id in APP_ID, `id de la investigación sin correspondencia: ${r.id}`).toBe(true);
    const mapped = new Set(Object.values(APP_ID).filter(Boolean));
    // La temperatura no está en la investigación: su ficha queda vacía.
    for (const t of BUILTIN_TOOLS) if (!mapped.has(t.id)) expect(TOOL_SHEETS[t.id]).toEqual({});
  });

  for (const r of research) {
    const appId = APP_ID[r.id];
    if (!appId) continue;
    it(`${r.id} → ${appId}: mismos números, null vacío, sin verificar marcado`, () => {
      const s = TOOL_SHEETS[appId]!;
      const n = (v: number | null) => (v === null || v === 0 ? undefined : v);
      // Profundidad de investigación (0 = contacto: nota sin número).
      expect(s.investigation?.typical).toBe(n(r.doiIn.typical));
      expect(s.investigation?.min).toBe(n(r.doiIn.min));
      expect(s.investigation?.max).toBe(n(r.doiIn.max));
      if (s.investigation) expect(s.investigation.unit).toBe('in');
      expect(s.verticalResolution?.typical).toBe(n(r.verticalResolutionIn));
      expect(s.length?.typical).toBe(n(r.lengthM));
      if (s.length) expect(s.length.unit).toBe('m');
      expect(s.diameter?.typical).toBe(n(r.odIn));
      if (s.diameter) expect(s.diameter.unit).toBe('in');
      const mounting = r.mounting === 'contact' ? 'pad' : r.mounting === 'none' ? undefined : r.mounting;
      expect(s.mounting).toBe(mounting);
      // Una cáscara por curva, con la profundidad de la investigación, solo de roles que la herramienta registra.
      const byRole = Object.fromEntries(Object.entries(s.investigationByRole ?? {}).map(([k, v]) => [k, v!.typical]));
      expect(byRole).toEqual(Object.fromEntries(r.shells.map((x) => [x.role, x.doiIn])));
      const tool = defaultToolCatalog.get(appId)!;
      for (const role of Object.keys(byRole)) {
        expect(tool.roles).toContain(role);
        expect(defaultRoleCatalog.has(role)).toBe(true);
      }
      // Sin verificar: los campos con número de la investigación quedan marcados (la DOI arrastra a la de cada curva).
      for (const f of r.unverified) {
        const key = FIELD[f];
        if (!key || s[key] === undefined) continue;
        expect(s.unverified, `${appId}: ${f}`).toContain(key);
        if (key === 'investigation' && s.investigationByRole) expect(s.unverified).toContain('investigationByRole');
      }
      // Ningún campo marcado sin verificar que la investigación da por verificado.
      const verifiedByResearch = Object.entries(FIELD).filter(([f]) => !r.unverified.includes(f)).map(([, k]) => k);
      for (const k of s.unverified ?? []) expect(verifiedByResearch, `${appId}: ${k} no está sin verificar en la investigación`).not.toContain(k);
      expect(s.sources).toEqual(r.sources.length ? r.sources : undefined);
      expect(s.measures?.startsWith(r.measures.replace(/\.$/, ''))).toBe(true);
      expect(s.limitations).toEqual([r.limitations]);
      expect(sheetOf(tool)).toBe(s);
    });
  }
});
