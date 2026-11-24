#!/usr/bin/env python3
"""
Valores de referencia INDEPENDIENTES (numpy/scipy) para tests/petro-micp-usos.test.ts (src/petro/micp.ts).

No comparte código con el motor TypeScript: los ajustes usan scipy (least_squares con arranques múltiples y cotas para
Thomeer; polyfit + minimize_scalar para Brooks–Corey), las raíces usan brentq y la altura sale de las unidades en SI.
Uso:  python3 scripts/qa/micp-usos-reference.py            (imprime las tablas)
      python3 scripts/qa/micp-usos-reference.py --json     (imprime JSON)
Requiere numpy, pandas, scipy.
"""
import json, re, sys
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.optimize import least_squares, minimize_scalar, brentq

ROOT = Path(__file__).resolve().parents[2]
KGF_TO_PSI = 98.0665 / 6.894757293          # kg/cm² → psi
PA_PER_PSI = 6894.757293
G = 9.80665
HG = 480 * abs(np.cos(np.radians(140)))     # σ|cosθ| mercurio–aire
OW = 30 * abs(np.cos(np.radians(30)))       # petróleo–agua
D_RHO = 1.05 - 0.80                         # g/cm³
MU_W, MU_O = 0.5, 1.0

def load():
    s = (ROOT / 'src/modules/rock-typing/tpMicp.ts').read_text()
    return json.loads(re.search(r'= (\[\{.*\}\]);', s, re.S).group(1))

def thomeer(pc, sw, phi):
    bv = (1 - sw) * phi * 100
    bmax = bv.max(); hi = max(bmax, phi * 100)
    def res(p):
        pd, g, binf = np.exp(p[0]), p[1], p[2]
        L = np.log10(np.maximum(pc / pd, 1e-300))
        m = np.where(pc > pd, binf * np.exp(-g / np.where(L > 0, L, 1)), 0.0)
        return m - bv
    best = None
    for lp in np.log(np.geomspace(pc[0], pc[-1] * 0.999, 30)):
        for g in (0.05, 0.1, 0.3, 1.0, 3.0):
            r = least_squares(res, [lp, g, 0.5 * (bmax + hi)], bounds=([np.log(pc[0]), 0.005, bmax], [np.log(pc[-1] * 0.999), 20, hi]),
                              xtol=1e-14, ftol=1e-14, gtol=1e-14)
            if best is None or r.cost < best.cost:
                best = r
    pd, g, binf = np.exp(best.x[0]), best.x[1], best.x[2]
    rmse = np.sqrt(2 * best.cost / len(pc))
    r2 = 1 - 2 * best.cost / np.sum((bv - bv.mean()) ** 2)
    return dict(pd=pd, G=g, bvInf=binf, rmse=rmse, r2=r2, bvMax=bmax)

def brooks_corey(pc, sw, entry=0.99):
    m = (sw <= entry) & (sw > 0)
    p, s = pc[m], sw[m]
    def sse(sr):
        se = (s - sr) / (1 - sr)
        c = np.polyfit(np.log(se), np.log(p), 1)
        r = np.log(p) - np.polyval(c, np.log(se))
        return np.sum(r ** 2), c
    hi = s.min() * 0.999
    grid = np.linspace(0, hi, 2001)
    vals = [sse(x)[0] if np.polyfit(np.log((s - x) / (1 - x)), np.log(p), 1)[0] < 0 else np.inf for x in grid]
    i = int(np.argmin(vals))
    sr = grid[i]
    if 0 < i < len(grid) - 1:
        sr = minimize_scalar(lambda x: sse(x)[0], bounds=(grid[i - 1], grid[i + 1]), method='bounded', options={'xatol': 1e-12}).x
    _, c = sse(sr)
    return dict(pd=np.exp(c[1]), lam=-1 / c[0], swirr=sr, bound='lower' if i == 0 else 'upper' if i == len(grid) - 1 else None)

def kr(sw, lam, swirr):
    se = max(0.0, (sw - swirr) / (1 - swirr))
    return se ** ((2 + 3 * lam) / lam), (1 - se) ** 2 * (1 - se ** ((2 + lam) / lam))

def fw(sw, lam, swirr, mw=MU_W, mo=MU_O, ):
    krw, kro = kr(sw, lam, swirr)
    return (krw / mw) / (krw / mw + kro / mo)

def height_m(pc_lab_psi, d_rho=D_RHO):
    return pc_lab_psi * (OW / HG) * PA_PER_PSI / (d_rho * 1000 * G)

def main():
    out = {}
    samples = load()
    df = pd.read_csv(ROOT / 'datos/pozo_tp_perfiles.csv')
    for x in samples:
        pc = np.array(x['pcKgCm2']) * KGF_TO_PSI
        sw = np.array(x['swPct']) / 100
        phi = x['phiPct'] / 100
        th = thomeer(pc, sw, phi)
        bv = (1 - sw) * phi * 100
        i = int(np.argmax(bv / pc))
        k_sw = 399 * (bv[i] / pc[i]) ** 1.691
        k_th = 3.8068 * th['G'] ** -1.3334 * (th['bvInf'] / th['pd']) ** 2
        bc = brooks_corey(pc, sw)
        cut = brentq(lambda s: fw(s, bc['lam'], bc['swirr']) - 0.5, bc['swirr'] + 1e-12, 1 - 1e-12, xtol=1e-14)
        w = df[(df.DEPTH >= x['depthM'] - 0.5) & (df.DEPTH <= x['depthM'] + 0.5)]
        ok = w[(w.PHIE_CMR > 0) & w.PHI_BVI.notna() & w.PHIE_CMR.notna()]
        ratio = ok.PHI_BVI.sum() / ok.PHIE_CMR.sum()
        # Pc a Sw = ratio: interpolación lineal en Sw y log en Pc, primer cruce
        pc_r = np.nan
        for j in range(len(pc) - 1):
            if sw[j] > ratio >= sw[j + 1]:
                t = (sw[j] - ratio) / (sw[j] - sw[j + 1]); pc_r = pc[j] * (pc[j + 1] / pc[j]) ** t; break
        out[x['sample']] = dict(
            kGas=x['kGasMd'], phiPct=x['phiPct'], pd=th['pd'], G=th['G'], bvInf=th['bvInf'], rmse=th['rmse'], r2=th['r2'],
            kSwanson=k_sw, apexPc=pc[i], apexSb=bv[i], kThomeer=k_th,
            bcPd=bc['pd'], bcLambda=bc['lam'], bcSwirr=bc['swirr'], bcBound=bc['bound'],
            entryHeightM=height_m(th['pd']), entryHeightBcM=height_m(bc['pd']), cutoff=cut,
            nWin=len(ok), bviPhie=ratio, pcBvi=pc_r, heightBviM=height_m(pc_r),
        )
    if '--json' in sys.argv:
        print(json.dumps(out, indent=1, default=float)); return
    keys = ['pd', 'G', 'bvInf', 'rmse', 'kSwanson', 'kThomeer', 'kGas', 'bcLambda', 'bcSwirr', 'entryHeightM', 'cutoff', 'bviPhie', 'heightBviM']
    print('muestra ' + ' '.join(f'{k:>12s}' for k in keys))
    for s, v in out.items():
        print(f'{s:7s} ' + ' '.join(f'{v[k]:12.4f}' for k in keys))
    # constantes de unidades
    print('factor Hg→petróleo–agua', OW / HG, ' psi/ft de 1 g/cc', 1000 * G * 0.3048 / PA_PER_PSI)

if __name__ == '__main__':
    main()
