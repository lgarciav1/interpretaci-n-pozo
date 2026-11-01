"""Referencia independiente (numpy, sin importar código de producción) para tests/petro-swi-pc.test.ts.

Calcula, a partir de tests/fixtures/tp-corona-electrica-scal.json (datos de la cátedra):
  1. el ajuste log-log de la presión de desplazamiento contra la «raíz» √(k/φ) de la tabla scal.displacement
     (Pd = c·x^(-d)): c, d, R² log-log y RMSE de Pd en kg/cm²;
  2. la relación entre la «raíz» de la tabla de desplazamiento (φ en fracción) y √(k/φ%) de la tabla de garganta
     poral (φ en %): debe ser 10;
  3. Swi de los seis niveles de la planilla para casos de mano (Swi = A·x^B/100, x = √(k/φ%));
  4. ida y vuelta: genera Swi con (A, B) del nivel 3 y los recupera con polyfit log-log.

Uso:  python3 -I scripts/qa/swi-pc-reference.py     (imprime JSON; los valores se copian al test)
"""
import json
import math
from pathlib import Path

import numpy as np

root = Path(__file__).resolve().parents[2]
scal = json.loads((root / 'tests/fixtures/tp-corona-electrica-scal.json').read_text())['scal']

# 1. Presión de desplazamiento
x = np.array([r['raiz'] for r in scal['displacement']])
pd = np.array([r['pDesplazKgCm2'] for r in scal['displacement']])
slope, intercept = np.polyfit(np.log(x), np.log(pd), 1)
pred_log = intercept + slope * np.log(x)
ss_res = float(np.sum((np.log(pd) - pred_log) ** 2))
ss_tot = float(np.sum((np.log(pd) - np.log(pd).mean()) ** 2))
pred = np.exp(intercept) * x**slope
disp = {
    'n': int(len(x)),
    'c': float(np.exp(intercept)),
    'd': float(-slope),
    'r2LogLog': 1 - ss_res / ss_tot,
    'rmseKgCm2': float(np.sqrt(np.mean((pd - pred) ** 2))),
}

# 2. Raíz de la tabla de garganta (φ en %) frente a la de desplazamiento (φ en fracción)
roots = [math.sqrt(t['kGasMd'] / t['phiPct']) for t in scal['poreThroat']]
ratio = [d['raiz'] / r for d, r in zip(scal['displacement'], roots)]

# 3. Casos de mano: Swi = A·x^B/100 con x = sqrt(k/φ%)
coef = scal['swiPowerLaw']['coef']


def swi_levels(k, phi_frac):
    xx = math.sqrt(k / (100 * phi_frac))
    return xx, [c['A'] * xx ** c['B'] / 100 for c in coef]


hand = {}
cases = {'k100_phi20': (100.0, 0.20), 'k1_phi10': (1.0, 0.10), 'k0.01_phi05': (0.01, 0.05)}
for name, (k, phi) in cases.items():
    xx, s = swi_levels(k, phi)
    hand[name] = {'x': xx, 'swi': s}

# 4. Ida y vuelta con el nivel 3
xs = np.linspace(0.4, 2.0, 12)
A3, B3 = coef[2]['A'], coef[2]['B']
sl, ic = np.polyfit(np.log(xs), np.log(A3 * xs**B3 / 100), 1)
roundtrip = {'A': float(100 * np.exp(ic)), 'B': float(sl)}

print(json.dumps({'displacement': disp, 'rootRatioDisplacementOverThroat': ratio, 'hand': hand, 'roundtrip': roundtrip}, indent=2))
