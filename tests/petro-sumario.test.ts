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
    expect(s.noDataPay).toBeCloseTo(0.5, 12); // la muestra 7: reservorio con Sw NaN
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
      const w = whole[key];
      // Los campos anidados (estadísticas, medias geométrica/armónica) se comparan enteros: mismas muestras, mismo orden.
      if (typeof w !== 'number') expect(both[key], key).toEqual(w);
      else if (Number.isNaN(w)) expect(both[key], key).toBeNaN();
      else expect(both[key], key).toBeCloseTo(w, 12);
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

// Regla 2 (Sw faltante en reservorio): se informa como «sin dato pay»; si falta TODO el Sw del reservorio, el pay es NaN.
function flagsFor(vsh: number[], phi: number[], sw: number[]) {
  const r = new Float64Array(vsh.length);
  const p = new Float64Array(vsh.length);
  netFlagsInto(vsh, phi, sw, r, p, { vshMax: 0.4, phiMin: 0.08, swMax: 0.6 });
  return { netRes: r, netPay: p };
}

describe('petro/summary: Sw faltante (regla 2)', () => {
  // 6 muestras de reservorio (h = 1, 1, 0,5, 0,5, 1, 1; vsh 0,1; φ 0,2; perm 10, 20, 30, 40, 50, 60)
  const h = [1, 1, 0.5, 0.5, 1, 1];
  const vsh = Array(6).fill(0.1);
  const phi = Array(6).fill(0.2);
  const perm = [10, 20, 30, 40, 50, 60];
  const mk = (sw: number[]): SummaryInput => ({ thickness: h, ...flagsFor(vsh, phi, sw), phi, sw, vsh, perm });

  it('Sw parcial: se suma lo conocido y el faltante queda en «sin dato pay»', () => {
    // Sw: .3, NaN, .5, .9, NaN, .4 → pay = muestras 0, 2, 5 (h 1 + 0,5 + 1 = 2,5); sin Sw = muestras 1 y 4 (2 m); no pay = muestra 3
    const s = summarizeRanges(mk([0.3, NaN, 0.5, 0.9, NaN, 0.4]), [{ start: 0, end: 6 }]);
    expect(s.netRes).toBeCloseTo(5, 12);
    expect(s.netPay).toBeCloseTo(2.5, 12);
    expect(s.noDataPay).toBeCloseTo(2, 12);
    expect(s.noData).toBe(0);
    expect(s.ntgPay).toBeCloseTo(2.5 / 5, 12);
    // h·φ·Sh = 0,2·(1·0,7 + 0,5·0,5 + 1·0,6) = 0,2·1,55 = 0,31
    expect(s.hphiShPay).toBeCloseTo(0.31, 12);
    expect(s.hphiPay).toBeCloseTo(0.2 * 2.5, 12);
    expect(s.khPay).toBeCloseTo(10 + 15 + 60, 12); // 1·10 + 0,5·30 + 1·60
    expect(s.swPay).toBeCloseTo((1 * 0.3 + 0.5 * 0.5 + 1 * 0.4) / 2.5, 12);
    // el reservorio: la Sw media usa solo las muestras con Sw
    expect(s.hphiShRes).toBeCloseTo(0.2 * (0.7 + 0.5 * 0.5 + 0.5 * 0.1 + 0.6), 12);
  });

  it('Sw totalmente NaN con reservorio: pay, h·φ·Sh y kh son NaN (no 0) y todo el reservorio es «sin dato pay»', () => {
    const s = summarizeRanges(mk(Array(6).fill(NaN)), [{ start: 0, end: 6 }]);
    expect(s.netRes).toBeCloseTo(5, 12);
    expect(s.noDataPay).toBeCloseTo(5, 12);
    expect(s.netPay).toBeNaN();
    expect(s.ntgPay).toBeNaN();
    expect(s.hphiPay).toBeNaN();
    expect(s.hphiShPay).toBeNaN();
    expect(s.khPay).toBeNaN();
    expect(s.swPay).toBeNaN();
    expect(s.hphiShRes).toBeNaN();
    expect(s.phiRes).toBeCloseTo(0.2, 12); // lo que no depende de Sw se conserva
    expect(s.ntgRes).toBeCloseTo(1, 12);
  });

  it('con Sw conocida pero todo alto: pay 0 (no NaN) y sin faltante', () => {
    const s = summarizeRanges(mk(Array(6).fill(0.9)), [{ start: 0, end: 6 }]);
    expect(s.netPay).toBe(0);
    expect(s.noDataPay).toBe(0);
    expect(s.hphiShPay).toBe(0);
  });

  it('sin reservorio: pay 0 y sin faltante, aunque el Sw sea NaN (la muestra se descarta por Vsh)', () => {
    const sw = Array(6).fill(NaN);
    const bad = Array(6).fill(0.9);
    const input = { thickness: h, ...flagsFor(bad, phi, sw), phi, sw, vsh: bad };
    const s = summarizeRanges(input, [{ start: 0, end: 6 }]);
    expect(s.netRes).toBe(0);
    expect(s.netPay).toBe(0);
    expect(s.noDataPay).toBe(0);
    expect(s.noData).toBe(0); // regla 1: descartadas, no «sin dato»
  });

  it('total: la zona sin Sw aporta 0 si otra tiene dato (se suma lo conocido); NaN si ninguna tiene', () => {
    const sw = [NaN, NaN, NaN, 0.3, 0.3, 0.3];
    const inp = mk(sw);
    const a = { start: 0, end: 3 }; // reservorio 2,5 m, todo sin Sw
    const b = { start: 3, end: 6 }; // reservorio 2,5 m, pay 2,5 m
    expect(summarizeRanges(inp, [a]).netPay).toBeNaN();
    const total = summarizeRanges(inp, [a, b]);
    expect(total.netPay).toBeCloseTo(2.5, 12);
    expect(total.noDataPay).toBeCloseTo(2.5, 12);
    expect(total.hphiShPay).toBeCloseTo(0.2 * 0.7 * 2.5, 12);
    const none = summarizeRanges(mk(Array(6).fill(NaN)), [a, b]);
    expect(none.netPay).toBeNaN();
  });
});
