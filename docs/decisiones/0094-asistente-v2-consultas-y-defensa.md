# ADR 0094 · Asistente v2: consultas analíticas, simulación exacta y preparación de defensa sin LLM

## Contexto

El Asistente F26 ([ADR 0083](0083-asistente-sin-modelo.md)) estableció un diseño determinista sin modelo de lenguaje para funcionar en un único HTML sin conexión y citar siempre la fuente de cada cifra. Sin embargo, su cobertura inicial se limitaba a 8 intenciones básicas sobre el sumario, el barrido 1D fijo de un cutoff y la lectura automática, sin acceso directo a:

- módulos avanzados (volumetría `OOIP`/`OGIP`, análisis MICP y G01–G09: coherencia cruzada G08, superficie 2D G09, movilidad `Sxo`/`MOS`/`MHI` G07, GR espectral `CGR` G06, presiones `MDT` G05, unidades hidráulicas `SMLP` G03, capas de pay, incertidumbre Monte Carlo y calibración con corona);
- comparaciones entre zonas, simulaciones exactas simultáneas de 1 o 2 cutoffs con aplicación explícita en historial (`Ctrl+Z`), consultas puntuales por profundidad (`@ MD`) y trazabilidad;
- búsquedas booleanas sobre curvas conectadas con la selección viva del visor (`PlotSelection`) ni comparación de cambios contra snapshots;
- preparación activa de una defensa oral real sobre el pozo cargado.

## Decisión

Evolucionar `src/app/assistant/` a **Asistente v2**, manteniendo **estrictamente 0 dependencias externas y 0 modelos de lenguaje (LLM)**:

1. **Gramática de slots/entidades con tolerancia tipográfica acotada:**
   - Se conserva `normalizeQuestion` y la compatibilidad exacta con F26 (`tests/assistant.test.ts`).
   - Se agrega distancia de Levenshtein acotada (`≤ 1` en palabras de 4–6 caracteres; `≤ 2` en `≥ 7` caracteres) **exclusivamente** sobre palabras léxicas largas y métodos/métricas; nunca sobre identificadores cortos de 1–3 letras (zonas `A`..`E`, roles `SW`, `GR`, `RT`, `PE`) para evitar falsos positivos.
   - El contexto admite memoria corta de sesión en el panel (`previousIntent`) para repreguntas naturales (*«¿y en la zona E?»*, *«¿y para gas?»*, *«¿y a 55 %?»*).

2. **Resolvers puros por dominio sobre motores y adaptadores existentes:**
   - Ningún resolver duplica ecuaciones petrofísicas: se reutilizan `evalCutoffPairPoint` y `buildCutoffSurfaceView` (`cutoff-sensitivity`), `traceSample` (`core/engine/provenance`), `diffInterpretations` / `describeDiff` (`core/state/snapshots`), `buildCrossCheckReport` (`cross-check`), `summarizeMdtZones` / `mdtAnalysis` (`mdt`), `resolveSmlp` (`flow-capacity`), `micpSamples` (`micp`), `porosityCalibration` / `matrixDensityEstimates` (`core-calibration`) y las tablas del motor (`ZONE_SUMMARY`, `VOLUMETRICS`, `PAY_INTERVALS`, `UNCERTAINTY`, `UNCERTAINTY_TORNADO`, `CGR_CALIBRATION`, `MOVABLE_SUMMARY`).
   - Cuando el llamador no aporta `well` ni `interpretation` (contrato mínimo de F26), la intención `cutoff` preserva el camino exacto de `CUTOFF_SWEEP`. Cuando están presentes, la simulación 1D/2D calcula el punto exacto con los cutoffs elegidos y ofrece el botón explícito **«Aplicar estos cutoffs»** (`commit` único con `setCutoffPairRecipe`, revertible con un solo `Ctrl+Z`).

3. **Selección booleana enlazada (`src/plots/link.ts`):**
   - Se extiende `SelectionSource` con `'assistant'` y `SelectionDetail` con `{ kind: 'filter'; label: string }`.
   - Consultas como *«Resaltá donde φ > 0,15 y Sw < 0,4 en zona D»* construyen una máscara `Uint8Array` sobre las curvas efectivas, resumen espesor y tramos, permiten aplicarla al enlace vivo entre visor y gráficos (`makeSelection` / `setPlotSelection`) y abrir directamente el diálogo de bandera de usuario (G02).

4. **Modo «Preparar defensa» (`defense.ts`):**
   - Analiza de forma perezosa (solo cuando la pestaña está abierta) las tensiones de G08, la estabilidad 2D G09 de cutoffs, derrumbes/barita, faltantes de pay, alertas MDT (`EMW`, compartimentalización), aporte de uranio G06, movilidad G07 y sensibilidad de Monte Carlo, generando tarjetas dinámicas con preguntas de examen oral y evidencia real del pozo cargado.

5. **Interfaz enriquecida con tokens y accesibilidad:**
   - Barra segmentada **`Preguntar | Preparar defensa`**, autocompletado por teclado (`↑/↓/Enter/Esc`) con zonas y curvas reales, mini-tablas interactivas con `Badge` semántico y filas clicables, historial de sesión clicable (reiniciado al cambiar de pozo) y botón **«Copiar con fuentes»**.
   - Se mantienen fuera de la interfaz las ecuaciones LaTeX (exclusivas del módulo **Ecuaciones**) y se usan exclusivamente tokens CSS de `src/ui/tokens.ts`.

## Consecuencias

- Todas las cifras citadas son 100 % verificables contra las tablas y curvas vigentes del motor.
- Funciona íntegramente offline en `dist/index.html` (`file://`), sin impacto en tamaño de bundle por pesos de modelos ni llamadas de red.
- Ninguna acción muta el proyecto automáticamente: aplicar cutoffs, guardar banderas o abrir la cortina siempre exige clic explícito del usuario y entra en el flujo normal de deshacer cuando corresponde.
