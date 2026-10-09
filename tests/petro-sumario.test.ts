import { describe, expect, it } from 'vitest';
import { netFlagsInto } from '../src/petro/cutoffs';
import { summarizeRanges, type SummaryInput } from '../src/petro/summary';

// Caso a mano de 8 muestras con espesores distintos (cuentas verificadas además con un script Python independiente).
const NaN_ = NaN;
const h = [0.5, 1, 0.5, 1, 2, 0.5, 1, 0.5];
const vsh = [0.1, 0.2, 0.4, 0.3, NaN_, 0.5, 0.1, 0.2];
const phi = [0.2, 0.15, 0.1, 0.12, 0.2, 0.25, 0.05, 0.18];
const sw = [0.3, 0.5, 0.6, 0.8, 0.4, 0.2, 0.3, NaN_];
const perm = [100, 50, 10, 5, 1, 1, 1, 20];
// Cutoffs 0,4 / 0,08 / 0,6 → NET_RES = [1,1,1,1,NaN,0,0,1]; NET_PAY = [1,1,1,0,NaN,0,0,NaN]
const netRes = Float64Array.from([1, 1, 1, 1, NaN_, 0, 0, 1]);
const netPay = Float64Array.from([1, 1, 1, 0, NaN_, 0, 0, NaN_]);
const input: SummaryInput = { thickness: h, netRes, netPay, phi, sw, vsh, perm };

describe('petro/summary: caso a mano de 8 muestras', () => {
  it('las banderas del caso son las de netFlagsInto con los cutoffs 0,4 / 0,08 / 0,6', () => {
    const r = new Float64Array(8);
    const p = new Float64Array(8);
    netFlagsInto(vsh, phi, sw, r, p, { vshMax: 0.4, phiMin: 0.08, swMax: 0.6 });
    expect(Array.from(r)).toEqual(Array.from(netRes));
    expect(Array.from(p)).toEqual(Array.from(netPay));
  });

  const s = summarizeRanges(input, [{ start: 0, end: 8 }]);

  it('espesores: bruto 7, sin dato 2 (la muestra 4), neto reservorio 3,5, neto pay 2', () => {
    expect(s.gross).toBeCloseTo(7, 12);
    expect(s.noData).toBeCloseTo(2, 12);
    expect(s.netRes).toBeCloseTo(3.5, 12); // 0,5+1+0,5+1+0,5
    expect(s.netPay).toBeCloseTo(2, 12); // 0,5+1+0,5
    expect(s.ntgRes).toBeCloseTo(0.5, 12);
    expect(s.ntgPay).toBeCloseTo(2 / 7, 12);
  });

  it('pay: φ̄ = 0,30/2 = 0,15; S̄w = 0,135/0,30 = 0,45; Vsh = 0,45/2; k = 105/2; kh = 105', () => {
    // Σhφ = 0,5·0,2 + 1·0,15 + 0,5·0,1 = 0,30; Σhφ·Sw = 0,03 + 0,075 + 0,03 = 0,135
    expect(s.phiPay).toBeCloseTo(0.15, 12);
    expect(s.swPay).toBeCloseTo(0.45, 12);
    expect(s.vshPay).toBeCloseTo(0.225, 12); // 0,05 + 0,2 + 0,2 = 0,45
    expect(s.kPay).toBeCloseTo(52.5, 10); // 50 + 50 + 5 = 105
    expect(s.khPay).toBeCloseTo(105, 10);
    expect(s.hphiPay).toBeCloseTo(0.3, 12);
    expect(s.hphiShPay).toBeCloseTo(0.165, 12); // 0,30 − 0,135
  });

  it('reservorio: la muestra 7 (Sw NaN) cuenta en φ̄ y Vsh pero no en S̄w ni en h·φ·Sh', () => {
    // Σhφ = 0,42 + 0,5·0,18 = 0,51 sobre 3,5 m → φ̄ = 0,145714…
    expect(s.phiRes).toBeCloseTo(0.51 / 3.5, 12);
    // S̄w solo con las muestras 0–3: Σhφ·Sw = 0,231; Σhφ = 0,42
    expect(s.swRes).toBeCloseTo(0.55, 12);
    expect(s.vshRes).toBeCloseTo(0.85 / 3.5, 12); // 0,05+0,2+0,2+0,3+0,1
    expect(s.hphiRes).toBeCloseTo(0.51, 12);
    expect(s.hphiShRes).toBeCloseTo(0.189, 12); // 0,42 − 0,231
  });

  it('identidad: h·φ̄·(1 − S̄w) = h·φ·Sh en el pay (todas las muestras pay tienen φ y Sw)', () => {
    expect(s.netPay * s.phiPay * (1 - s.swPay)).toBeCloseTo(s.hphiShPay, 12);
  });

  it('sin vsh → vsh NaN; sin perm → k y kh NaN; lo demás no cambia', () => {
    const t = summarizeRanges({ ...input, vsh: undefined, perm: undefined }, [{ start: 0, end: 8 }]);
    expect(t.vshRes).toBeNaN();
    expect(t.vshPay).toBeNaN();
    expect(t.kPay).toBeNaN();
    expect(t.khPay).toBeNaN();
    expect(t.hphiShPay).toBeCloseTo(0.165, 12);
    expect(t.netPay).toBeCloseTo(2, 12);
  });
});

describe('petro/summary: rangos y totales', () => {
  it('el total de dos rangos coincide con summarizeRanges de la unión (promedios desde las sumas)', () => {
    const a = { start: 0, end: 3 };
    const b = { start: 3, end: 8 };
    const both = summarizeRanges(input, [a, b]);
    const whole = summarizeRanges(input, [{ start: 0, end: 8 }]);
    for (const key of Object.keys(whole) as (keyof typeof whole)[]) {
      if (Number.isNaN(whole[key])) expect(both[key], key).toBeNaN();
      else expect(both[key], key).toBeCloseTo(whole[key], 12);
    }
    // y es distinto del promedio de promedios: φ̄pay de a (muestras 0–2) es 0,15 y de b es NaN (sin pay)
    const sa = summarizeRanges(input, [a]);
    const sb = summarizeRanges(input, [b]);
    expect(sa.phiPay).toBeCloseTo(0.15, 12);
    expect(sb.phiPay).toBeNaN();
    expect(sa.gross + sb.gross).toBeCloseTo(both.gross, 12);
  });

  it('neto cero: promedios NaN y sumas 0 (rango de las muestras 5–6, ambas no netas)', () => {
    const z = summarizeRanges(input, [{ start: 5, end: 7 }]);
    expect(z.gross).toBeCloseTo(1.5, 12);
    expect(z.netRes).toBe(0);
    expect(z.netPay).toBe(0);
    expect(z.ntgPay).toBe(0);
    expect(z.phiRes).toBeNaN();
    expect(z.swPay).toBeNaN();
    expect(z.vshPay).toBeNaN();
    expect(z.kPay).toBeNaN();
    expect(z.khPay).toBe(0);
    expect(z.hphiPay).toBe(0);
    expect(z.hphiShPay).toBe(0);
  });

  it('rango vacío: bruto 0 → N/G NaN; sin rangos igual', () => {
    const e = summarizeRanges(input, [{ start: 3, end: 3 }]);
    expect(e.gross).toBe(0);
    expect(e.ntgRes).toBeNaN();
    expect(e.ntgPay).toBeNaN();
    expect(summarizeRanges(input, []).gross).toBe(0);
  });
});
