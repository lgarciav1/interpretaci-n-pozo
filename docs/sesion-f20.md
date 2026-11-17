# Próxima sesión — F20: reconstrucción de densidad en derrumbes

Repositorio: https://github.com/lgarciav1/interpretaci-n-pozo

Este documento prepara una sesión nueva; no afirma que ya haya sido creada. En este entorno no está disponible
`create_session` de `claude-code-remote`. No se reemplaza una sesión nueva por un subagente con ese nombre.

## Prompt para iniciar

Sos la sesión de la cadena para **F20 — Reparar la densidad en los derrumbes**, última función de la línea de corte
para diciembre. Trabajá sobre `main` actualizado del repositorio `lgarciav1/interpretaci-n-pozo`.

1. Leé `AGENTS.md`, `CLAUDE.md`, `docs/cadena-de-funciones.md`, sección 2 y ficha F20 de
   `docs/masterplan-funciones-nuevas.md`, la arquitectura pertinente y las invariantes I01–I08 de
   `docs/masterplan-preparacion-y-drx.md` (especialmente I01 e I06). Confirmá que PR #89 está integrado y que F20
   sigue pendiente antes de implementar, para evitar repetir trabajo de otra sesión.
2. Creá una rama propia desde `main`; autor Lucas <lgarciav@fi.uba.ar>. Conservá los modelos y esfuerzo disponibles
   en Codex según AGENTS.md, sin fingir modelos Claude. La sesión principal orquesta; `analista-numerico` escribe
   el modelo y un agente distinto revisa las decisiones científicas y recalcula de forma independiente.
3. Antes de código, escribí un ADR con el próximo número libre: definición de buen pozo y derrumbe, variables
   disponibles/confiables, tratamiento de entradas también afectadas (especialmente neutrón), nulos/huecos,
   particiones por bloques de profundidad, métricas y umbral de error que impide ofrecer la reconstrucción.
   Definí cómo estimar y validar la banda de error, detectar extrapolación y señalar soporte insuficiente.
   Los criterios se fijan y justifican antes de evaluar el resultado; no se eligen para hacer pasar al modelo.
4. Entrená con tramos sanos del pozo y reconstruí ZDEN solo en intervalos explícitamente marcados como derrumbe.
   Usá la infraestructura existente de bosque aleatorio si su API es adecuada; confirmala en código. Evitá fuga
   de información entre entrenamiento y validación: no dividir muestras vecinas al azar ni usar el objetivo
   oculto al reconstruir bloques sintéticos. No asumas que neutrón, sónico o resistividad sean confiables por existir.
5. El resultado es una curva **preparada** con procedencia, parámetros, máscara de calidad y banda de error. Original
   inmutable y visible; ninguna sustitución automática de fuente activa. Aplicación explícita y reversible,
   persistencia y snapshots. Mostrar error y límites en pantalla, y conservar acceso a ecuaciones/documentación.
6. Validá con un pozo sintético ocultando bloques sanos: recuperación dentro del umbral definido, casos sin soporte,
   datos faltantes y extrapolación. En el TP real, informá R² y RMSE de validación en buen pozo y cobertura; distinguí
   validación de datos observados de estimación en derrumbes sin densidad verdadera de referencia.
   Compará porosidad antes/después mediante la cortina de snapshots, manteniendo visibles originales y fuentes.
7. Cumplí la ficha completa y verificaciones: typecheck, suite de tests, build de HTML único, capturas a 1366×768
   claro/oscuro y recorrido reproducible. No ejecutes benchmarks y navegador en paralelo. Pedí revisión independiente,
   corregí hallazgos y hacé verificar los arreglos. Actualizá masterplan, arquitectura y evidencia. Un bloqueo de
   navegador se informa como tal; no se presenta una prueba HTTP como aprobación de apertura `file://`.
8. Seguí la entrega de la cadena con un PR propio en español y merge squash únicamente con sus condiciones cumplidas
   y dentro de la autorización vigente. F20 es la última: no iniciar F22 ni otra función. Cerrá con un resumen de la
   cadena y de lo que quedó sin verificar.

## Contexto heredado de F05

F05 tiene notas por punto/tramo, edición, movimiento, historial, proyectos/snapshots, figuras e informe. Se revisó
independientemente y sus tres hallazgos de dibujo/interacción quedaron resueltos. Ver PR #89 y
`docs/validacion/2026-11-17-notas.md` para resultados exactos y limitaciones de navegador.

Las notas son metadatos fuera del motor (`Interpretation.notes?`); no deben usarse como etiquetas de entrenamiento
ni como decisión implícita de corrección. Mantener sus contratos al extender preparación y figuras.

## Datos y límites

Usar los datos reales disponibles del TP, documentados en `datos/README.md`. No inventar modelo de herramienta,
propiedades del lodo ni DRX para justificar una reconstrucción. F20 estima densidad a partir de otros registros;
no es una corrección ambiental física validada para una herramienta.

## Mapa confirmado en código al preparar el relevo

- `src/ml/forest.ts`: `trainRandomForest`/`predictForest`, `ForestModel`, `TrainingMatrix` y `ForestOptions` son
  **clasificación**, con índices de clase en `y` y salida de probabilidades. No hay un regresor de densidad listo.
  La elección/extensión para regresión requiere ADR y tests propios; no convertir clases a RHOB.
- `src/ml/validation.ts`: `depthBlockFolds({wellIds, depth, nFolds, blockLength, gap, seed})` ya separa bloques con
  buffer. Las métricas y `forestFitPredict` actuales son de clasificación, no RMSE/R² de densidad.
- `src/modules/ind-washout/index.ts`: produce `IND_WASHOUT`, usa CALI y BS opcional y `washoutFlagInto` de
  `src/petro/indicators.ts`; distingue bueno, derrumbe y sin dato. Confirmar y justificar umbrales para F20.
- `src/io/qc.ts`: `runQc`, `getCurveQc`, `unreliableMask`; `BoreholeQc` separa derrumbes y caliper inválido.
  Su máscara combinada no equivale a una selección exclusiva de derrumbes.
- `src/core/preparation/state.ts`: recetas cerradas de máscara, interpolación, filtro, desplazamiento, MGT y
  normalización; no existe reconstrucción ML. F20 necesita extender el contrato, validación y persistencia.
- `src/core/preparation/plan.ts`: `planPreparation`, `PreparedPayload`, `validatePreparedPayloads`,
  `materializePreparation` y `projectedEngineCurves`. `projection.ts` valida `PreparedArtifact` con revisión de
  entradas, `depthKey`, `recipeKey`, entradas versionadas y calidad. `source.ts` genera ids `prep:...`.
- `src/core/preparation/quality.ts`: excluido/interpolado/filtrado/corregido/fuera de dominio/normalizado;
  no hay bandera propia de estimación ML. Definir semántica de calidad y banda de error antes de codificar.
- `src/app/preparation/data.ts`, `view.ts` y `src/core/state/preparation.ts`: enlace de las curvas preparadas
  con la app. No guardar arrays derivados en el JSON del proyecto ni elegir la fuente preparada silenciosamente.
- `src/core/state/snapshots.ts`: fija interpretación y revisión de entradas. `src/app/snapshots/snapshotEngine.ts`
  calcula snapshots aisladamente; `ViewerSlot.tsx` y `src/viewer/curtain.ts` conectan comparación y alineación de pistas.
- TP: GR, ZDEN/RHOB, DT, NPHI y AT10/30/60/90 disponibles. `datos/README.md` documenta caliper inválido, picos de
  NPHI y huecos de DT. Su existencia no demuestra que cada predictor sea fiable en un intervalo concreto.

Este mapa lo comprobó un subagente explorador en modo lectura. La sesión F20 debe reconfirmarlo sobre el `main`
que encuentre, especialmente si hubo cambios posteriores.
