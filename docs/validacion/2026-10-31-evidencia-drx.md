# P4b — Evidencia persistente y exportación DRX, 2026-10-31

Base: `f123514ea90b954cd29fb1206f80681b6c68ae86`, PR #50. Sin integrar main. [Contrato ADR 0043](../decisiones/0043-evidencia-persistente-drx.md).

## Qué queda disponible

Guardar configuración y evidencia de comparación DRX en una receta reversible, recuperar parámetros/procedencia de densidades, verificar contenido tras reabrir o restaurar snapshot, y exportar la tabla completa con evidencia y composición original. Las huellas no dependen de identidades de arrays en memoria. Evidencia histórica y tabla vigente no se confunden. No aplica GR, Vsh ni cutoffs.

## Verificación

Suite completa: **2.792 pruebas, 163 archivos, sin fallos ni omisiones**, `npm test -- --maxWorkers=1`. Once pruebas nuevas de evidencia. Tras los últimos ajustes de descriptor/columnas exportadas y borrador de UI se repitieron las **21 pruebas DRX** y typecheck/build, aprobados; no se atribuye una segunda suite completa a esos ajustes.

Pruebas nuevas: una receta/no-op y conservación de originales/parámetros; undo/redo; guardar/reabrir con huellas idénticas; snapshots; invalidación ante revisión, valores, calidad, geometría, exclusiones y offset; fuente ausente sin sustitución; rechazo de aceptación sobre otro Project, estructura inválida y versiones futuras; CSV completo/procedencia/defensa contra fórmulas y rechazo de resultados o entradas alterados; cancelación sin evidencia parcial; resultados no finitos y arcilla nativa >1 bloqueados; preparación regenerada con arrays nuevos tras reabrir; SHA-256 fallback sin SubtleCrypto.

Chromium por HTTP local, 1366×768, TP con evento/laboratorio sintéticos explícitos. Se ejecutó `scripts/qa/runs-xrd.py --evidence`, que primero repite registro/preview/aceptación de corrida y carga/pares de P4a. Extensión P4b:

- Convierte masa a volumen con densidades declaradas Q=3 y C=2 y referencias «Ensayo QA Q/C». Dos filas utilizables, resultados 0,5 y 0,6; fila ND/BLD sin contenido total.
- Guarda evidencia; verifica CSV descargado, referencias y tabla completa; guardar proyecto; undo elimina el ajuste, redo lo recupera.
- Cierra la página y abre el proyecto en un contexto de navegador nuevo, sin reutilizar caches. La evidencia aparece sin verificar; recupera configuración/referencias y vuelve a comparar. Ambas huellas coinciden y la UI indica verificación.
- Cambiar offset oculta la exportación de la tabla anterior; recalcular advierte que la evidencia guardada no corresponde a la configuración actual.
- Un archivo con versión futura del registro se abre mostrando el error específico; al guardar de nuevo se conserva versión 2, sin sobrescritura silenciosa.

Sin excepciones de página. [Resultado](2026-10-31-evidencia-drx/navegador.json), [captura de la comparación revisada](2026-10-31-evidencia-drx/comparacion.png). El CSV y proyectos de QA se regeneran, no se versionan datos de usuario.

HTML final: **5.661.628 bytes**, SHA-256 `89dd9d86065d984403f0d303f107074c74afe3262efa62884d3f58535d723894` (+10.479 bytes, ~0,185 % frente a #50). Sin nuevas dependencias de producción. Se mantienen v7 y preparación esquema 4; ajustes JSON versionados en el mecanismo existente de PointSetDecisions.

## Reproducción

```sh
npm ci
npm run typecheck
npm test -- --maxWorkers=1
npm run build
node scripts/qa/alignment.mjs /tmp/p3p4-seed
python -m http.server 4178 --directory dist
# Otra terminal, con Playwright Python y Chromium:
python scripts/qa/runs-xrd.py --evidence --seed /tmp/p3p4-seed --output /tmp/p4b-browser
```

## Límites

No se repitió toda la matriz visual/DPR/temas ni un benchmark comparativo. La incertidumbre de densidad se conserva, sin propagación estadística. No hay datos DRX reales ni incertidumbres/límites numéricos de detección por muestra importados del ensayo. Bases distintas siguen en conjuntos homogéneos separados. P4 completa continúa abierta y P5 no queda habilitada por esta evidencia.

Fallback SHA-256 comprobado en pruebas sin SubtleCrypto. No se volvió a ensayar doble clic: la verificación previa de file:// fue bloqueada por la política de Chromium. La nueva validación de navegador usa HTTP local; no certifica doble clic ni un dispositivo táctil físico.
