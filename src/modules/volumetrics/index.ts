/**
 * Módulo de volumen in situ (OOIP/OGIP por zona). Ver 0007, C22 y D4.
 * Puertos en SI canónico: m³ a condiciones de superficie. La tabla trae además unidades de campo (MMbbl, Bcf).
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output, type TableCell, type ZoneScalarValue } from '../../core/module';
import { convert } from '../../core/units';
import { zoneInPlace } from '../../petro/volumetrics';
import { SHARED_PARAMS } from '../sharedParams';

const FLUID_LABEL = { oil: 'Petróleo', gas: 'Gas', none: 'Sin hidrocarburo' } as const;

const num = (x: number): TableCell => (Number.isFinite(x) ? x : null);

/** Suma los valores finitos; NaN si no hay ninguno. */
function sumFinite(xs: readonly number[]): number {
  let s = 0;
  let c = 0;
  for (const x of xs) {
    if (Number.isFinite(x)) {
      s += x;
      c++;
    }
  }
  return c > 0 ? s : NaN;
}

export default defineModule({
  id: 'volumetrics',
  name: 'Volumen in situ',
  description: 'Petróleo o gas in situ de cada zona a partir del espesor equivalente de hidrocarburo, el área y el factor de volumen.',
  category: 'volumetrics',
  workspace: 'petrophysics',
  inputs: {
    hphiSh: input.zoneScalar('HPHISH_PAY'),
  },
  params: {
    area: SHARED_PARAMS.area,
    fluid: SHARED_PARAMS.fluid,
    bo: SHARED_PARAMS.bo,
    bg: SHARED_PARAMS.bg,
  },
  outputs: {
    ooip: output.zoneScalar('OOIP', { label: 'Petróleo in situ', unit: 'm3' }),
    ogip: output.zoneScalar('OGIP', { label: 'Gas in situ', unit: 'm3' }),
    ooipTotal: output.scalar('OOIP_TOTAL', { label: 'Petróleo in situ total', unit: 'm3' }),
    ogipTotal: output.scalar('OGIP_TOTAL', { label: 'Gas in situ total', unit: 'm3' }),
    table: output.table('VOLUMETRICS', {
      label: 'Volumen in situ por zona',
      columns: [
        { key: 'zone', label: 'Zona', kind: 'text' },
        { key: 'fluid', label: 'Fluido', kind: 'text' },
        { key: 'area', label: 'Área', unit: 'km2' },
        { key: 'hphiSh', label: 'h·φ·Sh', unit: 'm' },
        { key: 'b', label: 'Factor de volumen', unit: 'm3/m3' },
        { key: 'ooipSi', label: 'Petróleo in situ', unit: 'Mm3' },
        { key: 'ooipField', label: 'Petróleo in situ', unit: 'MMbbl' },
        { key: 'ogipSi', label: 'Gas in situ', unit: 'MMm3' },
        { key: 'ogipField', label: 'Gas in situ', unit: 'Bcf' },
      ],
    }),
  },
  compute({ inputs, zones, paramsFor, warn }) {
    const ooip: ZoneScalarValue = {};
    const ogip: ZoneScalarValue = {};
    const rows: Record<string, TableCell>[] = [];
    if (zones.length === 0) {
      warn('Definí zonas para calcular el volumen: el área y el fluido se eligen por zona.');
      return { ooip, ogip, ooipTotal: NaN, ogipTotal: NaN, table: { rows } };
    }

    const hphiList: number[] = [];
    for (const z of zones) {
      const p = paramsFor(z.id);
      const h = inputs.hphiSh[z.id]!;
      const seal = z.kind === 'seal';
      if (!seal && p.fluid !== 'none' && Number.isNaN(h)) {
        warn(`En la zona ${z.name} no hay h·φ·Sh (sin muestras clasificadas o sin Sw en el reservorio): el volumen queda sin dato.`, { zoneId: z.id });
      }
      const v = seal ? { ooip: 0, ogip: 0 } : zoneInPlace(p.fluid, p.area * 1e6, h, p.bo, p.bg);
      ooip[z.id] = v.ooip;
      ogip[z.id] = v.ogip;

      const fluid = seal ? 'Sello' : FLUID_LABEL[p.fluid];
      const shows = !seal && p.fluid !== 'none';
      if (!seal) hphiList.push(h);
      rows.push({
        zone: z.name,
        fluid,
        area: seal ? null : num(p.area),
        hphiSh: seal ? null : num(h),
        b: shows ? (p.fluid === 'oil' ? p.bo : p.bg) : null,
        ooipSi: p.fluid === 'gas' && !seal ? null : num(convert(v.ooip, 'm3', 'Mm3')),
        ooipField: p.fluid === 'gas' && !seal ? null : num(convert(v.ooip, 'm3', 'MMbbl')),
        ogipSi: p.fluid === 'oil' && !seal ? null : num(convert(v.ogip, 'm3', 'MMm3')),
        ogipField: p.fluid === 'oil' && !seal ? null : num(convert(v.ogip, 'm3', 'Bcf')),
      });
    }

    const ooipTotal = sumFinite(zones.map((z) => ooip[z.id]!));
    const ogipTotal = sumFinite(zones.map((z) => ogip[z.id]!));
    rows.push({
      zone: 'Total',
      fluid: null,
      area: null,
      hphiSh: num(sumFinite(hphiList)),
      b: null,
      ooipSi: num(convert(ooipTotal, 'm3', 'Mm3')),
      ooipField: num(convert(ooipTotal, 'm3', 'MMbbl')),
      ogipSi: num(convert(ogipTotal, 'm3', 'MMm3')),
      ogipField: num(convert(ogipTotal, 'm3', 'Bcf')),
    });
    return { ooip, ogip, ooipTotal, ogipTotal, table: { rows } };
  },
  docs: {
    summary:
      'Volumen de petróleo o gas in situ por zona (método volumétrico): área por espesor equivalente de hidrocarburo, llevado a condiciones de superficie con el factor de volumen. Las zonas de tipo sello no aportan volumen.',
    equations: [
      { latex: 'OOIP = \\frac{A\\,(h\\,\\phi\\,S_h)}{B_o}', description: 'Petróleo, en m³ estándar (STB).' },
      { latex: 'OGIP = \\frac{A\\,(h\\,\\phi\\,S_h)}{B_g}', description: 'Gas, en m³ estándar (scf).' },
      { latex: 'h\\phi S_h = \\sum h_i\\,\\phi_i\\,(1 - S_{w,i})', description: 'Sumado sobre el pay neto.' },
    ],
    references: [
      'Dake, L. P. (1978). Fundamentals of Reservoir Engineering. Elsevier.',
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.',
    ],
    notes:
      'Verificación: 1 acre por 1 pie de h·φ·Sh con B = 1 equivale a 7758 bbl. El área se toma por zona (km²); Bo en bbl/STB y Bg en ft³/scf son iguales a m³/m³.',
  },
});
