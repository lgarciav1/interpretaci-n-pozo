"""Referencia independiente de la normalización de curvas (docs/decisiones/0060).

Calcula con numpy (percentiles `method="linear"`, la definición 7 de Hyndman y Fan, 1996) los casos que
`tests/preparation-normalization.test.ts` copia como valores esperados:

1. percentiles de una serie conocida;
2. ida y vuelta: una curva «descalibrada» m = 0,8·t + 0,03 normalizada P5/P95 → P5/P95 de t recupera t;
3. caso con NaN y una exclusión, con el intervalo de referencia en MD;
4. dominio físico (NPHI en [−0,15, 1] v/v), desplazamiento y escala.

Los datos son racionales (sin funciones trascendentes) para que TypeScript y numpy usen exactamente los mismos
números. Uso: python3 scripts/qa/normalization-reference.py
"""
import json

import numpy as np


def series(n):
    i = np.arange(n, dtype=float)
    return ((np.arange(n) * 37) % 101) / 100 + i / 1000


def two_point(x, x_lo, x_hi, y_lo, y_hi):
    gain = (y_hi - y_lo) / (x_hi - x_lo)
    return y_lo + (x - x_lo) * gain, gain


out = {}

# 1. Percentiles (definición 7).
x1 = series(120)
out["case1"] = {p: float(np.percentile(x1, p)) for p in (0, 5, 12.5, 50, 95, 100)}

# 2. Ida y vuelta de una transformación conocida.
t = series(120) * 0.5 + 0.05
m = 0.8 * t + 0.03
t_lo, t_hi = np.percentile(t, [5, 95])
m_lo, m_hi = np.percentile(m, [5, 95])
recovered, gain2 = two_point(m, m_lo, m_hi, t_lo, t_hi)
out["case2"] = {
    "sourceLow": float(m_lo),
    "sourceHigh": float(m_hi),
    "targetLow": float(t_lo),
    "targetHigh": float(t_hi),
    "gain": float(gain2),
    "maxAbsError": float(np.max(np.abs(recovered - t))),
}

# 3. NaN y exclusión; intervalo de referencia [5, 45] m MD, exclusión [10, 12] m MD.
n3 = 100
i3 = np.arange(n3)
depth3 = i3 * 0.5
data3 = 50 + ((i3 * 13) % 29) - 0.25 * i3
data3[[3, 17, 40, 41, 42]] = np.nan
excluded = (depth3 >= 10) & (depth3 <= 12)
masked = np.where(excluded, np.nan, data3)
in_ref = (depth3 >= 5) & (depth3 <= 45)
sample = masked[in_ref & np.isfinite(masked)]
lo3, hi3 = np.percentile(sample, [5, 95])
norm3, gain3 = two_point(masked, lo3, hi3, 20.0, 80.0)
out["case3"] = {
    "samples": int(sample.size),
    "sourceLow": float(lo3),
    "sourceHigh": float(hi3),
    "gain": float(gain3),
    "values": {str(k): (None if np.isnan(norm3[k]) else float(norm3[k])) for k in (0, 3, 9, 20, 50, 99)},
    "finite": int(np.isfinite(norm3).sum()),
}

# 4. Dominio físico, desplazamiento y escala.
x4 = series(120)
lo4, hi4 = np.percentile(x4, [10, 90])
norm4, gain4 = two_point(x4, lo4, hi4, -0.1, 0.95)
out["case4"] = {
    "sourceLow": float(lo4),
    "sourceHigh": float(hi4),
    "gain": float(gain4),
    "below": int((norm4 < -0.15).sum()),
    "above": int((norm4 > 1).sum()),
    "min": float(norm4.min()),
    "max": float(norm4.max()),
}
p50 = float(np.percentile(sample, 50))
shifted = masked + (60.0 - p50)
scaled = masked * (75.0 / p50)
out["case4"]["shift"] = {"source": p50, "value50": float(shifted[50]), "value99": float(shifted[99])}
out["case4"]["scale"] = {"source": p50, "gain": 75.0 / p50, "value50": float(scaled[50]), "value99": float(scaled[99])}

print(json.dumps(out, indent=2))
