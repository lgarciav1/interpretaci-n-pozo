# P4c → P5a — laboratorio DRX y calibración GR con evidencia

Fecha: 2026-10-31. Base `fbab980e824bf9be041789518896b0ca61542d18` (#51). Entrega apilada sin integrar main. Contratos: [auxiliares DRX](../decisiones/0044-incertidumbres-y-limites-drx.md) y [calibración GR](../decisiones/0045-calibracion-gr-drx-con-evidencia.md).

## Resultado

P4 incorpora incertidumbres absolutas, notas de su significado, límites numéricos y censura `<valor`, con validación, revisión, persistencia y exportación. Ninguna censura se convierte en cero/medición; no se propaga una incertidumbre que no esté definida estadísticamente.

P5a ofrece propuestas zonales para los cinco métodos Vsh canónicos, usando un proxy volumétrico y laboratorio independiente declarados. Agrupa réplicas/soportes próximos, exige rango y asociación suficientes, valida bloques de profundidad sin soporte compartido, comprueba estabilidad de extremos y recalcula métricas después del redondeo. El preview usa el motor aislado; aceptar publica parámetros/evidencia en una receta. Conserva originales, fuentes, otras zonas y cutoffs. La validación con DRX real y las extensiones de P5 siguen separadas de esta entrega.

## Pruebas

Corrida final sobre el código funcional: **2.814 pruebas, 165 archivos, sin fallos ni omisiones**, `npm test -- --maxWorkers=1`. Typecheck, build y diff check aprobados. Incremento sobre #51: cinco pruebas de laboratorio y diecisiete de calibración/integración. La corrida anterior de 2.813 pasó antes de detectar el problema de preview de identidad descrito abajo; no se usa como sustituto de la corrida final.

La referencia [xrd-gr-known.json](../../tests/fixtures/xrd-gr-known.json) se calculó independientemente con Python a partir de las ecuaciones publicadas; no llama funciones de producción. Conserva las entradas y salidas numéricas esperadas de lineal, Larionov terciario/antiguo, Clavier y Steiber, para extremos conocidos 30/120 gAPI. Los cinco recuperan los extremos y pasan validación por bloques. No son muestras reales de laboratorio.

Cobertura nueva: auxiliares y escalas originales, límites contradictorios/texto inválido, censura/legado/round-trip; extremos conocidos para cinco métodos; pérdida y métricas tras redondear; rango estrecho, pendiente inversa, cotas, falta de validación independiente y GR casi constante con bajo RMSE agregado; réplicas y contradicciones; incertidumbre informada/densidad excesiva; fuentes preparadas/calculadas/inactivas, masa nativa y relación física inválida; cancelación; aceptación zonal atómica/obsoleta; cutoffs/fuentes/otras zonas/originales intactos; historial, archivo y snapshots; versiones futuras. La prueba de protocolo ejecuta preview de identidad y preparado con cliente/motor en proceso reales.

## Navegador

Chromium, HTTP local, 1366×768, HTML de producción. `xrd-calibration-seed.mjs` genera perfil y DRX explícitamente sintéticos: 20 filas de laboratorio, 18 localizaciones, una réplica y una censurada; incertidumbre C=0,01 y límite=0,002 en fracción de volumen de sólidos. GR conocido 25/135 gAPI, parámetros iniciales de la zona 50/160. No se presenta como una campaña real.

`xrd-calibration.py` verificó:

- Importación por UI de base volumen/escala fracción, nota de incertidumbre, mapeo de auxiliares y revisión de datos originales. Censura y auxiliares conservados.
- Bloqueo hasta declarar independencia del laboratorio y relación constitutiva; 18 localizaciones después de agrupar réplicas/excluir censura.
- Recuperación de 25/135, preview aislado sin pedidos al motor principal, invalidación por controles y Project guardado idéntico antes/después de preview/cancelación.
- Promedio Vsh de la zona: **0,2720 → 0,4682** en preview. PHIE/Sw aparecen sin dato porque este fixture solo contiene GR; no se inventan resultados.
- Aplicación zonal, parámetros y evidencia correctos; fuentes, otras zonas, cutoffs y todos los blobs/revisiones originales idénticos. Un undo/redo recupera exactamente los proyectos previo/aplicado.
- Guardar snapshot, reabrir en otro contexto de navegador y consultar evidencia histórica. Restauración por UI.

`xrd-calibration-checks.py` profundiza dos casos: cambia grClean a 40 y elimina la evidencia actual manteniendo el snapshot; restaurar recupera 25/135 y la evidencia completa. También carga el HTML por HTTP, desconecta la red y deshabilita Worker/SubtleCrypto: comparación, ajuste, preview y aplicación recuperan 25/135 con el fallback real.

Sin excepciones de página en los recorridos finales. [Resultado principal](2026-10-31-calibracion-gr-drx/navegador.json), [snapshot cambiado/fallback](2026-10-31-calibracion-gr-drx/offline-y-snapshot.json), [preview revisado](2026-10-31-calibracion-gr-drx/preview.png).

### Problema encontrado y corregido

El primer recorrido de navegador detectó una excepción al enviar un plan de preparación vacío para un GR original. El protocolo exige plan solo cuando hay receta. Se incorporó `calibrationPreviewRequest`, que sigue el contrato de snapshots: contexto identidad sin plan y preparación real con plan. Se agregó una prueba de integración con ambos casos, se repitió la suite completa y pasó el recorrido final. El efecto captura además errores síncronos para mantener el editor/proyecto disponibles. No se cambió ni relajó la validación del protocolo.

## Artefacto y reproducción

HTML final: **5.690.760 bytes**, SHA-256 `4e08a3d3414299ee9e15902d2d55b84d2908e06f71d51ccd4f254765fcb742b0` (+29.015 bytes, ~0,512 % sobre #51). Sin nuevas dependencias de producción. Se mantienen v7 y preparación esquema 4; datos/evidencia se incorporan en columnas/ajustes PointSet existentes.

```sh
npm ci
npm run typecheck
npm test -- --maxWorkers=1
npm run build
node scripts/qa/xrd-calibration-seed.mjs /tmp/p5-seed
python -m http.server 4178 --directory dist
# Otra terminal, Playwright Python + Chromium:
python scripts/qa/xrd-calibration.py --seed /tmp/p5-seed --output /tmp/p5-browser
python scripts/qa/xrd-calibration-checks.py --artifacts /tmp/p5-browser
```

## Límites

No se declara validación con DRX real ni equivalencia universal arcillas–Vsh. Los umbrales son admisión operativa versionada; las métricas no prueban causalidad ni producen intervalos de confianza. No se incorpora ajuste de un solo extremo fijado, propagación estadística o calibración conjunta entre zonas. Los cutoffs siguen siendo una decisión separada mediante herramientas existentes.

No se repitió toda la matriz de pantallas/DPR/temas ni un benchmark comparativo; la búsqueda está acotada/cooperativa según ADR 0045. El fallback offline verificado parte del HTML servido por HTTP; file:// conserva la limitación de política documentada previamente. Main sigue sin estas funciones hasta revisar/integrar la cadena de PR.
