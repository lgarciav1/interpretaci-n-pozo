"""Calcula fixtures matemáticos sintéticos desde las ecuaciones publicadas, sin importar producción.
Goldberg et al. (2004), Proc. ODP SR191, cap.6, p.10, ecuaciones2–4.
No representa datos ni validación experimental de campo.
"""
from decimal import Decimal, getcontext
from pathlib import Path
import json
getcontext().prec = 50
rows = []
for raw in ['3.5', '8.5', '9', '12', '16']:
    d = Decimal(raw)
    t = Decimal('1.316') * d - Decimal('3.5')
    c = Decimal('.82') - Decimal('.00131') * t + Decimal('.00559') * t**2 - Decimal('.000245') * t**3 + Decimal('.0000047') * t**4
    e = Decimal('.812') + Decimal('.0244') * t + Decimal('.000136') * t**2 - Decimal('.00000822') * t**3
    rows.append({'diameterIn': float(d), 'centered': float(c), 'eccentered': float(e), 'gr100Centered': float(100*c), 'gr100Eccentered': float(100*e)})
Path('tests/fixtures/mgt-known.json').write_text(json.dumps({'source': 'Goldberg et al. 2004, p.10 equations 2–4; independent Python Decimal(50). Synthetic mathematical cases, not experimental field validation.', 'rows': rows}, indent=2) + '\n')
