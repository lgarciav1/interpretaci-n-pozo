# P5b — Ajuste GR condicionado a un extremo externo

Fecha: 2026-10-31. Base `2e487cb758c37172a1d66a32e42a0919d5a7cf46` (#52). Sin integrar main. [Contrato ADR 0046](../decisiones/0046-extremo-gr-externo-fijo.md).

## Resultado

Permite fijar explícitamente limpio o lutítico desde una referencia externa y ajustar solo el otro, con los cinco métodos Vsh. Conserva el valor fijo exactamente, su incertidumbre/nota y la declaración externa; mantiene admisión, preview aislado, aceptación zonal y evidencia. No cambia cutoffs, fuentes, originales u otras zonas. El modo de dos extremos de P5a permanece predeterminado y mantiene su esquema/política.

## Pruebas

**2.832 pruebas en 166 archivos, sin fallos ni omisiones**, suite completa con un worker; typecheck/build/diff check aprobados. Dieciocho pruebas nuevas:

- Diez combinaciones método × extremo fijado con fixture Python independiente de 30/120 gAPI. El ajuste libre de ambos queda bloqueado por falta de un extremo; condicionado recupera el libre y conserva exactamente el externo en raw/aplicable/todos los folds.
- Fuera de paso/rango, incertidumbres/referencias/atestación inválidas, referencia incompatible con los datos, soporte libre/rango/GR constante/bloques insuficientes y cancelación.
- Un extremo externo en cota está permitido; el libre en cota sigue bloqueado. Métricas tras redondear y estabilidad continúan las puertas de P5a.
- v2 conserva referencia/incertidumbre en guardar/reabrir, undo/redo y snapshots. Cutoffs/fuentes/otras zonas/originales preservados. Un extremo alterado en raw/aplicable/folds/binding se rechaza, igual que versiones futuras.
- El recibo v1 congelado de #52 se lee sin cambios. Los fixtures/procedencia están en [tests/fixtures](../../tests/fixtures/xrd-gr-fixed-provenance.md).

El programa `xrd-fixed-compat.mjs` ejecuta el lector real de `2e487cb`: acepta v1 y rechaza v2 con error de versión explícito. Comprueba lectura de evidencia, no promete funciones nuevas en una app anterior. [Resultado de compatibilidad](2026-10-31-extremo-externo-gr/compatibilidad.json).

## Navegador

Chromium, HTTP local, 1366×768, HTML de producción. Tres casos sintéticos explícitos: lineal con limpio fijo, lineal con lutítico fijo y Clavier con limpio fijo. Veinte filas/18 localizaciones, una réplica y una censurada; sin campaña real.

Se verificó bloqueo de dos extremos por falta de soporte; rechazo de externo fuera de paso; declaración externa requerida; escritura decimal con coma; valor fijo intacto en raw/aplicable/folds, sin solicitudes al motor principal durante preview. Cambiar referencia invalida el resultado. Aplicación 25/135 gAPI con parámetros/método correctos, evidencia v2 y procedencia/incertidumbre 1,5 gAPI; originales/blobs, fuentes, otras zonas y cutoffs idénticos. Un undo/redo reproduce los proyectos previo/aplicado. Otro contexto de navegador recupera la historia. Un snapshot restaura parámetros y referencia después de cambiarlos/eliminarlos. Una versión futura 3 se informa y se conserva al guardar.

La regresión completa `xrd-calibration.py` de P5a también pasó sobre este HTML: modo de dos extremos v1, laboratorio/preview sin modificar Project, aplicación zonal, historial, reapertura y snapshots. Sin excepciones de página en ambos recorridos. [P5b](2026-10-31-extremo-externo-gr/navegador.json), [regresión P5a](2026-10-31-extremo-externo-gr/regresion-dos-extremos.json), capturas [limpio fijo](2026-10-31-extremo-externo-gr/limpio-fijo.png) y [lutita fija](2026-10-31-extremo-externo-gr/lutita-fija.png), revisadas.

## Artefacto y reproducción

HTML final **5.697.525 bytes**, SHA-256 `4c7128e3746e4ccafe5fba08de9c2066d3ef8c7a968ddcc37b4313a11f033231` (+6.765 bytes, ~0,119 % frente a #52). Sin dependencias nuevas. Project v7 y preparación esquema 4; solo la evidencia restringida agrega schema 2. No se guardan buffers derivados del tamaño del pozo.

```sh
npm ci
npm run typecheck
npm test -- --maxWorkers=1
npm run build
node scripts/qa/xrd-fixed-seed.mjs /tmp/p5b-seed
python -m http.server 4178 --directory dist
# Otra terminal, con Playwright Python y Chromium:
python scripts/qa/xrd-fixed.py --seed /tmp/p5b-seed --output /tmp/p5b-browser
node scripts/qa/xrd-fixed-compat.mjs /tmp/p5b-browser
# Regresión de dos extremos:
node scripts/qa/xrd-calibration-seed.mjs /tmp/p5-seed
python scripts/qa/xrd-calibration.py --seed /tmp/p5-seed --output /tmp/p5b-legacy-browser
```

El chequeo del lector original necesita el objeto Git `2e487cb`; en un clon superficial hay que disponer de la historia de la rama base. El temporal creado por el script se comprueba antes de escribir y se elimina al terminar.

## Límites

No se certifica referencia externa ni se propaga incertidumbre a intervalos de confianza. La variación cero del fijo es una condición del modelo. Persisten la campaña DRX real, la propagación estadística y la calibración conjunta entre zonas como pendientes de P5. No se repitió toda la matriz visual/DPR/temas, benchmark comparativo ni fallback offline de P5a; no cambian protocolo ni transporte. file:// conserva la limitación de política previamente documentada. Main permanece intacto y sin estas funciones hasta revisar/integrar la cadena.
