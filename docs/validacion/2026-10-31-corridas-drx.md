# Cierre funcional P3 e inicio P4a — 2026-10-31

Base: P3e, `440455ff487c229ed838e311fffdf19eef75ee8a` (#49). Entrega apilada, sin mergear ni modificar main. Contratos: [corridas/correlación](../decisiones/0041-corridas-y-validacion-independiente.md), [DRX diagnóstico](../decisiones/0042-drx-diagnostico-inicial.md).

## Resultado y alcance

- P3: registrar corridas observadas, previsualizar todas sus curvas, alinear/activar o retirar el lote atómicamente, conservar etapas previas e historial; correlación diagnóstica con búsqueda y validación sin soporte compartido. Completa el alcance funcional inicial de limpieza/alineación constante sobre P3a–e. No agrega deformación variable ni validación geológica automática.
- P4a: carga CSV/xlsx con mapeo explícito, base/escala/alcance y referencia MD/datum; estados ND/LD/no medido distintos; cierre sin renormalización; conversión masa→volumen con densidades declaradas; puntos e intervalos con soporte/cobertura/dispersión/QC. Usa originales o preparadas del contexto común y bloquea una publicación obsoleta.
- La comparación DRX es diagnóstica; no equivale arcilla a lutita ni calibra GR/cutoffs. P4 completa y P5 siguen abiertas. Las limitaciones pendientes figuran en ADR 0042.

## Pruebas y compilación

`npm test -- --maxWorkers=1`: **2.781 pruebas, 162 archivos, sin fallos ni omisiones**. Incremento: cinco pruebas de corrida/correlación y diez de DRX sobre las 2.766 de #49. La primera suite anterior a DRX también aprobó 2.771/161. Tras los ajustes finales de referencia/datum y retirada por corrida se repitieron las quince pruebas nuevas, typecheck y build, aprobados. Los cambios posteriores de plegado de secciones/estilo se verificaron con typecheck/build y recorridos de navegador. No se atribuye una segunda suite completa al último ajuste visual.

Casos nuevos: pertenencia disjunta, rechazo total ante curva inválida/roles alternativos, lote con fuentes y arrays independientes, guardado/reapertura, un undo/redo, retirada, no-op; signo conocido y Pearson en ventana reservada, constantes no identificables, soporte compartido y cancelación. DRX: masa/volumen/fracción explícitos, densidades conocidas independientes (60/3 y 40/2 → 50 % arcilla en sólidos), cierre incompleto, fracción arcilla, negativos, ND/LD/faltantes, ft→m, réplicas, mapeos repetidos/textos desconocidos, interpolación puntual sin extrapolar, barreras, integral de perfil lineal en grilla irregular (media 2 y desviación √(4/3) sobre [0,4]), hueco grande con cobertura 2/11, decisiones/exclusiones/offset por corrida, cancelación y archivo v7.

HTML final: 5.651.149 bytes, SHA-256 `2cf4e868b888ccaed2c0a326372f77b5c4b2f476add5fe398b6c890347c2dde5` (+29.590 bytes, ~0,53 % frente a #49).

Sin nuevas dependencias de producción ni cambio del contenedor v7/esquema 4. La extensión opcional `preserveRawCells` no cambia los lectores por defecto.

## Navegador

Chromium, 1366×768, HTTP local, HTML de producción, TP con evento/laboratorio sintéticos explícitos generado por `scripts/qa/alignment.mjs`.

El recorrido nuevo `scripts/qa/runs-xrd.py` verifica registro de dos curvas de distinto rol, preview del lote completo, aplicación, guardar, un undo y redo, importación de tres muestras DRX (una réplica), conservación ND/BLD y comparación contra GR preparada con QC del soporte. Resultado esperado: fracciones de arcilla 0,4 y 0,5, fila censurada sin total, sin excepciones de página. Se ejecutó con activación por Enter y con `has_touch`/tap sobre Aplicar; no es una certificación de toda la navegación con lector de pantalla ni de un teléfono físico. Un recorrido adicional confirma el estilo de tablas final.

La regresión existente `scripts/qa/alignment.py` aprobó: 5.810 filas, evento +0,3048 m de índice 1000→1002; cada valor original, otra curva, índice maestro y laboratorio conservados; QC 32/160 revisado fila a fila; signo negativo y reemplazo sin acumulación; preview sin motor principal/cancelación; undo/redo; guardar/reabrir y restaurar snapshot; quitar alineación; rechazo atómico de datum conocido incompatible/esquema futuro y fallback sin Worker/SubtleCrypto. Sin excepciones. LAS base SHA-256 `6c375164330070a107e49ed9d15b063a79c4b350a38846ca4bb2b4a335e3dd9c`; alineado positivo `5e9061c87679898d6bb0bb0011f1e3a9c3ea0a547a7a4ae2339989a0a4dada16`.

Capturas: [corrida](2026-10-31-corridas-drx/corrida-preview.png), [pares DRX](2026-10-31-corridas-drx/drx-pares.png). Resultados: [teclado](2026-10-31-corridas-drx/teclado.json), [tacto](2026-10-31-corridas-drx/tacto.json).

## Reproducción

```sh
npm ci
npm run typecheck
npm test -- --maxWorkers=1
npm run build
node scripts/qa/alignment.mjs /tmp/p3p4-seed
python -m http.server 4178 --directory dist
# En otra terminal (requiere Playwright Python y Chromium):
python scripts/qa/runs-xrd.py --seed /tmp/p3p4-seed --output /tmp/corridas-drx-teclado
python scripts/qa/runs-xrd.py --touch --seed /tmp/p3p4-seed --output /tmp/corridas-drx-tacto
python scripts/qa/alignment.py --seed /tmp/p3p4-seed --candidate index.html --output /tmp/alineacion-regresion
```

## Límites de la evidencia

No se repitió toda la matriz visual de resoluciones/DPR/temas ni un benchmark comparativo de latencia. Los métodos conservan sus límites explícitos y la tabla DRX rechaza el trabajo excesivo; no se promete rendimiento para campañas grandes. No hay datos DRX reales ni validación contra un informe de laboratorio externo. Densidades y configuración de pares son transitorias en este inicio P4a. No se ha validado una herramienta ambiental.

Se intentó abrir `file://` con Chromium: rechazado con `ERR_BLOCKED_BY_ADMINISTRATOR`. Se verificó fallback sin Worker/SubtleCrypto por HTTP; no se certifica el doble clic ni se elude esa política. La cadena de PR sigue pendiente de revisión/integración y main no ofrece aún estas funciones.
