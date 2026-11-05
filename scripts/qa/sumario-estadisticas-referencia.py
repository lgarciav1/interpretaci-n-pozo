#!/usr/bin/env python3
"""Referencia independiente (NumPy) de tests/petro-sumario-estadisticas.test.ts: medias geométrica/armónica de k y RT
y P10/P50/P90 ponderados del pozo del TP, completo y zona A (también RT en el reservorio neto, `statsRes.rt`).

No traduce el TS: implementa la definición matemática del cuantil ponderado (Hazen ponderado): muestras ordenadas por
valor, cada una en el punto medio de su tramo de la acumulada, c_j = (S_{j-1} + w_j/2)/W, e interpolación lineal de
p sobre (c_j, x_j) (np.interp, que fija los extremos fuera de [c_1, c_n]). Se valida contra
np.percentile(method='hazen') con pesos iguales. Pesos: h para φ, Vsh, k, RT; h·φ para Sw (volumen poral).

Uso: python3 scripts/qa/sumario-estadisticas-referencia.py
"""
import csv
import numpy as np

H = 0.1524


def wq(x, w, probs):
    x, w = np.asarray(x, float), np.asarray(w, float)
    ok = np.isfinite(x) & np.isfinite(w) & (w > 0)
    x, w = x[ok], w[ok]
    if x.size == 0:
        return [float('nan')] * len(probs)
    o = np.argsort(x, kind='stable')
    x, w = x[o], w[o]
    c = (np.cumsum(w) - w + w / 2) / w.sum()
    return [float(np.interp(p, c, x)) for p in probs]


# Validación del cuantil ponderado: con pesos iguales debe coincidir con Hazen de NumPy.
_r = np.random.default_rng(0).lognormal(size=257)
assert np.allclose(wq(_r, np.ones(_r.size), [.1, .5, .9]), np.percentile(_r, [10, 50, 90], method='hazen'), rtol=1e-12)
# Pesos desiguales a mano: x = [1,2,3], w = [1,2,1] -> c = [.125,.5,.875] -> P50 = 2, P10 = 1, P90 = 3
assert wq([1, 2, 3], [1, 2, 1], [.5, .1, .9]) == [2.0, 1.0, 3.0]

with open('datos/pozo_tp_perfiles.csv', newline='') as f:
    rows = list(csv.DictReader(f))


def col(name):
    return np.array([float(r[name]) if r[name] != '' else np.nan for r in rows])


phi, bvi, rt, gr = col('PHIE_CMR'), col('PHI_BVI'), col('AT90'), col('GR')
zona = np.array([r['ZONA'] for r in rows])
with np.errstate(all='ignore'):
    ffi = phi - bvi
    k = np.where((phi > 0) & (bvi > 0), np.where(ffi <= 0, 0.0, (100 * phi / 10) ** 4 * (ffi / bvi) ** 2), np.nan)
    vsh = np.clip((gr - 30) / 90, 0, 1)
    sw = np.minimum(1, np.sqrt(0.02 / (phi ** 2 * rt)))
    res = phi >= 0.08
    pay = res & (rt >= 2)


def report(label, mask_zone):
    r = res & mask_zone
    p = pay & mask_zone
    print(f'== {label}: netRes/h = {r.sum()}, netPay/h = {p.sum()}')
    kp, rp = k[p], rt[p]
    for nm, v in (('k', kp), ('RT', rp)):
        v = v[np.isfinite(v) & (v > 0)]
        print(f'  {nm}: geo = {np.exp(np.mean(np.log(v)))!r}  harm = {len(v) / np.sum(1 / v)!r}  arith = {v.mean()!r}')
    print('  kPay (aritmética sobre todas las muestras con dato) =', float(np.nanmean(kp)))
    pr = lambda nm, v, w: print(f'  {nm}: {wq(v, w, [.1, .5, .9])!r}')
    pr('phi res', phi[r], np.ones(r.sum()))
    pr('vsh res', vsh[r], np.ones(r.sum()))
    pr('sw res (peso h·φ)', sw[r], phi[r])
    pr('sw res (peso h, VIEJO)', sw[r], np.ones(r.sum()))
    pr('sw pay (peso h·φ)', sw[p], phi[p])
    pr('k pay', kp, np.ones(p.sum()))
    pr('rt pay', rp, np.ones(p.sum()))
    # RT en el reservorio neto (statsRes.rt): mismo conjunto que φ de reservorio, peso h; nulos = RT sin dato.
    rr = rt[r]
    pr('rt res', rr, np.ones(r.sum()))
    print(f'  rt res: nulos = {int(np.sum(~np.isfinite(rr)))}')


report('pozo completo', np.ones(len(rows), bool))
report('zona A', zona == 'A')
