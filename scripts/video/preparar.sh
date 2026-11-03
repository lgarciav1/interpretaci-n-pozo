#!/usr/bin/env bash
# Prepara la carpeta de trabajo del video de presentación (cuadros, escenas y datos generados; no va al repo).
# Uso: scripts/video/preparar.sh <carpeta de trabajo>
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
V="$REPO/scripts/video"
mkdir -p "$1"
W="$(cd "$1" && pwd)"

# Escenas servidas por el renderizador: apertura (three.js) y compositor.
cp -r "$V/opening" "$V/comp" "$W/"
cp "$REPO/node_modules/three/build/three.module.js" "$REPO/node_modules/three/build/three.core.js" "$W/opening/"

# GR real del TP para la apertura.
python3 -I - "$REPO/datos/pozo_tp_perfiles.csv" "$W/opening/gr.json" <<'EOF'
import csv, json, sys
r = list(csv.DictReader(open(sys.argv[1])))
json.dump({'depth': [round(float(x['DEPTH']), 3) for x in r],
           'gr': [(round(float(x['GR']), 2) if x['GR'] else None) for x in r],
           'zone': [x['ZONA'] for x in r]}, open(sys.argv[2], 'w'))
EOF

# Registro escaneado en ángulo, con verdad conocida, para el segmento del digitalizador.
python3 -I "$REPO/scripts/qa/make-digitizer-scan.py" "$W/scan"

echo "Carpeta lista: $W"
