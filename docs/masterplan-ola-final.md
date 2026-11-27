# Masterplan — Ola Final: Petrofísica Aplicada, Interacción Conectada y Defensa TP

- **Estado:** en ejecución. Cada función se marca como `hecha` en la sección 3 al integrarse en `main`.
- **Fecha:** 2026-11-24. **Base:** `main` (`804ce80`). **Próximo ADR libre al iniciar:** `0088` (confirmar siempre en `docs/decisiones/`).
- **Ejecución:** sesiones encadenadas con **Orchestrator (Neon)** siguiendo [`docs/cadena-ola-final.md`](cadena-ola-final.md), [`CLAUDE.md`](../CLAUDE.md) y [`AGENTS.md`](../AGENTS.md).
- **Alcance seleccionado:** las 5 funciones de la primera propuesta (SMLP interactivo, CGR sin uranio, Movilidad `Sxo`/`MOS`, Lazo → Acción, Coherencia cruzada) + las 3 de mayor retorno y cero duplicación de la segunda (Regla viva de Pay, Carta MID inmune a baritina y Exceso de presión en MDT; se descartó escaneo `r(Δz)` de corona porque `src/petro/depthMatch.ts` ya lo implementa). Dos funciones adicionales quedan en reserva (G09, G10).

---

## 1. Reglas invariables y optimización de tokens

1. **Una función = una rama (`feat/gXX-...`) + un PR + squash merge a `main`.** La app compila y pasa tests en cada commit. Autor Git: `Lucas <lgarciav@fi.uba.ar>`.
2. **Cero física inventada.** Solo datos presentes en `datos/pozo_tp_perfiles.csv`, MDT, corona y SCAL/MICP embebidos. Constantes empíricas u orientativas se declaran explícitamente en avisos y en `docs` (Ecuaciones).
3. **Motor puro con tests.** Todo cálculo va en `src/petro/` sin UI ni React, con tests en `tests/` contra cuentas cerradas a mano o casos analíticos. Las ecuaciones van **solo** en `docs` del módulo (pantalla Ecuaciones).
4. **Compatibilidad de proyecto.** Todo campo nuevo en `Interpretation`, `Project` o `Display` es **opcional y JSON puro** (o usa `Interpretation.moduleState[moduleId]`). Los archivos v6/v7 existentes deben abrir sin cambios.
5. **Economía estricta de tokens:**
   - Leé solo tu ficha (usá `StartLine`/`EndLine` en este archivo) y los archivos listados en **Mapa confirmado**. No leas `docs/arquitectura.md` completo.
   - En Windows PowerShell usá siempre `$env:PATH = "C:\Program Files\nodejs;$env:APPDATA\npm;$env:PATH"` y `npm.cmd` / `npx.cmd`.
   - Durante el desarrollo corré únicamente tu test nuevo (`npx.cmd vitest run tests/<archivo>.test.ts`). La corrida completa (`npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build`) se ejecuta **una sola vez al cierre** delegada en `explorador` (`flash_lite`).
   - Revisión independiente obligatoria con un subagente nuevo distinto de quien escribió el código (si escribió el orquestador en tareas C/M, revisa un subagente dedicado; en matemática no trivial o tamaño G escribe `analista-numerico`/`arquitecto` y revisa otro).

---

## 2. Cola de ejecución y tandas

Tamaño: **C** chico, **M** mediano, **G** grande. El orden maximiza valor temprano, aísla riesgos y deja al final el panel integrador G08 para que aproveche las salidas nuevas.

| Orden | ID | Función | Tanda | Tam. | Rol autor | ADR | Estado |
|---|---|---|---|---|---|---|---|
| 1 | G01 | Regla viva de Pay al medir un intervalo | 1 · Interacción rápida | C | desarrollador-ui | no | hecha |
| 2 | G02 | Del Lazo a la Acción (exclusión QC y bandera de usuario) | 1 · Interacción rápida | M | desarrollador-ui | [0088](decisiones/0088-del-lazo-a-la-accion.md) | hecha |
| 3 | G03 | Unidades hidráulicas interactivas en Lorenz Estratigráfico (SMLP) | 1 · Interacción rápida | M | analista-numerico | no | hecha |
| 4 | G04 | Carta MID (`ρ_maa` vs. `Δt_maa`) inmune a la baritina del lodo | 2 · Diagnóstico TP | C | analista-numerico | no | hecha |
| 5 | G05 | Exceso de presión (`P − ρ_ref·g·z`) y EMW en MDT | 2 · Diagnóstico TP | M | analista-numerico | [0089](decisiones/0089-exceso-de-presion-y-emw-en-mdt.md) | hecha |
| 6 | G06 | Rayos Gamma sin Uranio (`CGR`) conectado a `IGR` / `Vsh` | 3 · Petrofísica y cierre | M | analista-numerico | [0090](decisiones/0090-rayos-gamma-sin-uranio-cgr.md) | hecha |
| 7 | G07 | Hidrocarburo Móvil vs. Residual (`Sxo`, `MOS`, `Rt–Rxo` y pila) | 3 · Petrofísica y cierre | G | analista-numerico | [0091](decisiones/0091-hidrocarburo-movil-residual-sxo.md) | hecha |
| 8 | G08 | Panel de «Coherencia Cruzada entre Herramientas» (defensa TP) | 3 · Petrofísica y cierre | M | analista-numerico | [0092](decisiones/0092-coherencia-cruzada-entre-herramientas.md) | hecha |

### Reserva (solo si se habilita expresamente tras G08)
| ID | Función | Tam. | Resumen |
|---|---|---|---|
| G09 | Superficie 2D de estabilidad de Cutoffs (`φ_min × Sw_max`) | M | Grilla 2D en `cutoff-sensitivity` con curvas de nivel de Pay/Volumen y mira arrastrable para distinguir mesetas de barrancos. |
| G10 | Cascada (*Waterfall*) de atribución entre Snapshots | M | Descomposición por etapa (`Preparación → Vsh → φ → Archie → Cutoffs`) del `Δ Pay` / `Δ Volumen` en `SummaryCompare`. |

---

## 3. Fichas autocontenidas (líneas indexadas para lectura parcial)

### G01 — Regla viva de Pay al medir un intervalo
- **Qué hace:** al usar «Medir un intervalo» en el visor (arrastre y medida fija hasta `Esc`), además de `tope–base · Δh` muestra en una tarjeta compacta junto al corchete las métricas petrofísicas del tramo calculadas sobre las curvas activas vigentes: espesor reservorio (`NET_RES`), espesor *pay* (`NET_PAY` y `NTG`), `φe` media en reservorio, `Sw` media ponderada por volumen poral en *pay*, `k` media geométrica (si hay `PERM`), `k·h` y `h·φ·Sh`. En el menú contextual del visor (cuando hay una medición activa) agrega «Copiar ficha del intervalo medido» y «Crear nota en el intervalo medido».
- **Mapa confirmado en código:**
  - `src/viewer/overlays/measure.ts`: `createMeasureTool`, `MEASURE_OVERLAY_ID`, dibuja el corchete y la píldora en canvas.
  - `src/viewer/contextMenu.ts`: `Measurement`, `measureInterval`, `measureLabel`.
  - `src/viewer/WellViewer.tsx` y `src/app/shell/ViewerSlot.tsx`: instancian la herramienta, tienen acceso a las curvas resueltas / resultado vigente del motor (`useResults`) y a `NotesDialog` / portapapeles (`src/ui/clipboard.ts`).
  - `src/petro/summary.ts` y `src/petro/flowCapacity.ts`: convenciones exactas de promedios (ponderación por `thickness`, `Sw` ponderada por `φ·h` en *pay*, `k` geométrica para `k > 0`). Reusar o extraer función pura `summarizeDepthInterval` en `src/petro/summary.ts` para no duplicar fórmulas.
- **Límites:** no modifica zonas, interpretación ni historial al medir; si faltan curvas calculadas (p. ej. pozo sin cutoffs), muestra solo `tope–base · Δh` y las magnitudes disponibles sin inventar ceros.
- **Terminado cuando:** en una zona con *pay*, medir exactamente el tope–base completo de la zona arroja el mismo `netRes`, `netPay`, `φ`, `Sw` y `h·φ·Sh` que la fila de la zona en `ZONE_SUMMARY` (test unitario en `tests/`); el arrastre mantiene fluidez en canvas; «Copiar ficha…» copia TSV legible; capturas claro/oscuro con un banco medido en el pozo del TP.

---

### G02 — Del Lazo a la Acción (exclusión en Preparación y bandera de usuario)
- **Qué hace:** cuando existe una `PlotSelection` activa (`src/plots/link.ts`: lazo/rectángulo en crossplot, clases de histograma, rango de distribuciones o tramo del visor), la barra/píldora de selección ofrece dos acciones explícitas y deshacibles (`commit`):
  1. **«Guardar como bandera…»**: pide nombre corto (p. ej. `Arena limpia TS` o `Anomalía baritina`) y guarda una curva discreta `0/1` de usuario en el pozo/interpretación, visible de inmediato en el selector de filtros genéricos de gráficos (`Banderas`, PR #112) y en «Armar pistas».
  2. **«Excluir tramos en Preparación…»**: elige la curva medida objetivo (por defecto la del eje Y o X si es medida, p. ej. `ZDEN`, `NPHI` o `AT10`), pide motivo obligatorio y agrega los `DepthRun` de la selección como rangos de exclusión en `Preparation` respetando las invariantes científicas I01–I08 (original intacto, activación explícita si aún no usa curva preparada, un paso de `Ctrl+Z`).
- **ADR previo (`docs/decisiones/`):** decidir dónde persisten las banderas creadas por selección para preservar originales inmutables e invariantes de `Preparation`: campo opcional JSON puro `userFlags?: UserFlagDef[]` en `Interpretation` (guardando tramos compactos `[start, end]` o intervalos MD sobre el índice del pozo, proyectados como curvas de rol/familia `flag` en el contexto de gráficos y visor) vs. curva medida derivada. Preferir `Interpretation.userFlags?` opcional y JSON puro para no ensuciar `Well.curves` originales ni invalidar revisiones de entrada.
- **Mapa confirmado en código:**
  - `src/plots/link.ts` (`PlotSelection`, `selectionTitle`, `clearPlotSelection`) y `src/plots/selection.ts` (`maskRuns`).
  - `src/plots/controls.tsx`, `src/plots/crossplot/CrossplotPanel.tsx`, `src/plots/FilterControls.tsx` y `src/plots/filters.ts` (`filterCurveOptions`, `isFlagCurve`).
  - `src/core/interpretation.ts`, `src/core/state/serialize.ts` (v6/v7 opcionales), `src/core/state/preparation.ts` (recetas de exclusión por rangos MD).
- **Terminado cuando:** encerrar con lazo un grupo de puntos en Densidad–Neutrón permite crear una bandera y filtrar el Pickett por esa bandera (`= 1` o `= 0`), se deshace con `Ctrl+Z`, persiste al guardar/reabrir proyecto y los proyectos viejos abren igual; la acción de exclusión en Preparación respeta I01–I08 con tests dedicados.

---

### G03 — Unidades hidráulicas interactivas en el Lorenz Estratigráfico (SMLP de Gunter)
- **Qué hace:** convierte el gráfico de Lorenz estratigráfico de `flow-capacity` en una herramienta interactiva de zonación hidráulica (Stratigraphic Modified Lorenz Plot, Gunter et al., 1997):
  - Permite **marcar/quitar quiebres sobre la curva estratigráfica** con clic y ofrecer un botón **«Sugerir quiebres»** (con control de sensibilidad/cantidad máxima de segmentos, ajustando tramos lineales por tramos sobre `F_kh(F_φh)` en `src/petro/flowCapacity.ts`).
  - Calcula y muestra una tabla de **sub-unidades hidráulicas SMLP** de arriba hacia abajo: `Unidad (S1, S2…)`, `Tope–Base (m)`, `Δh (m)`, `% φ·h`, `% k·h`, pendiente `(% k·h) / (% φ·h)` (índice de flujo relativo) y carácter (`Conducto` si pendiente > 1,3; `Homogéneo` entre 0,7 y 1,3; `Barrera / Sello parcial` si < 0,3; `Subordinado` en el resto, declarando en nota/Ecuaciones que los umbrales de rótulo son operativos).
  - Superposición opcional en el visor (`src/modules/flow-capacity/overlay.ts`) que pinta las sub-unidades SMLP de la zona elegida, y botón «Partir zona en este quiebre» (`commit` sobre recetas de `src/core/state/zones.ts`).
- **Persistencia:** quiebres elegidos por zona guardados en `Interpretation.moduleState['flow-capacity']` (claves estables en MD al cm; si cambia la zona se avisa/limpia sin corromper nada, igual que `pay-intervals`). No toca contratos del motor.
- **Mapa confirmado en código:**
  - `src/petro/flowCapacity.ts` y `src/modules/flow-capacity/index.ts`, `model.ts`, `panel.tsx`.
  - `src/modules/pay-intervals/` como referencia exacta de `moduleState` + `overlay.ts` + salto al visor.
  - `src/core/state/zones.ts` para partir una zona con `Ctrl+Z`.
- **Terminado cuando:** en un reservorio sintético de 3 capas (conducto arriba, barrera al medio, reservorio homogéneo abajo), el segmentador puro recupera exactamente los 2 quiebres y las sumas de `% φ·h` y `% k·h` dan `100 %`; los quiebres manuales persisten en `moduleState`, entran en `Ctrl+Z` y se ven en el visor y capturas claro/oscuro.

---

### G04 — Carta MID (`ρ_maa` vs. `Δt_maa`, Clavier & Rust) inmune a baritina
- **Qué hace:** resuelve la limitación real del pozo del TP documentada en `datos/README.md` (el `PE` supera 4 b/e con baja densidad en el 96 % del pozo por baritina en el lodo, invalidando `Umaa`). Agrega el cálculo puro del **tiempo de tránsito aparente de matriz `Δt_maa`** (`DTMAA`, en `µs/ft`) a partir de `DT` y `PHIT`:
  `Δt_maa = (Δt − φ_t · Δt_fl) / (1 − φ_t)` (con guarda de circularidad si `PHIT` proviene solo del sónico, análoga a `sameAsDensity` de `core-calibration`), y añade la plantilla **«Identificación de matriz sin PE (MID: ρmaa–Δtmaa)»** en el Crossplot libre con los vértices de cuarzo, calcita, dolomía, anhidrita y yeso, grilla ternaria cuarzo–calcita–dolomía y flechas orientativas de gas, porosidad secundaria y arcilla (Clavier & Rust, 1976; Schlumberger CP-15).
- **Mapa confirmado en código:**
  - `src/petro/lithologyIndices.ts`: constantes de matrices (`LITHOLOGY_MATRICES` ya tiene `rho` y `dt` de cuarzo, calcita, dolomía, anhidrita, halita y yeso), agregar `apparentMatrixTransitTime`, `apparentMatrixTransitTimeInto` y geometría ternaria MID.
  - `src/modules/lithology-indices/index.ts`: declarar rol `DTMAA` (`unit: 'us/ft'`) y salida `dtmaa` cuando haya `dt` y `phit` (avisando circularidad si `PHIT` coincide con `PHIS`). Documentar ecuación y cita de Clavier & Rust (1976) en `docs`.
  - `src/core/plots.ts` (`CrossplotTemplateId`: sumar `'mid'`) y `src/plots/crossplot/templates.ts` (`CROSSPLOT_TEMPLATE_DEFS` y `lithologyTemplateLayers`).
- **Terminado cuando:** para mezclas sintéticas puras de cuarzo/calcita/dolomía con agua dulce (`φ` entre 0 y 0,35), `(DTMAA, RHOMAA)` cae exactamente sobre los vértices minerales independientemente de la porosidad (test numérico); en el pozo del TP la nube limpia cae en el campo cuarzo–calcita sin verse arrastrada por la baritina del `PE`; ecuaciones en Ecuaciones y capturas claro/oscuro.

---

### G05 — Exceso de presión (`P − ρ_ref·g·z`) y EMW en MDT
- **Qué hace:** amplía el panel y la pista «Presiones MDT» sin alterar los gradientes ni contactos guardados:
  1. **Modo de eje X:** `Presión in situ` (actual) | **`Exceso de presión`** (`P_ex(z) = P(z) − [P_0 + ρ_ref·g·(z − z_0)]`) | **`Densidad equivalente (EMW)`** (`ρ_eq = P / (g · z)`, en `lb/gal` o `g/cm³`, declarando datum `z = 0`).
  2. En **Exceso de presión**, el usuario elige `ρ_ref` (por defecto `1,00 g/cm³`, con presets agua dulce `1,00`, salmuera `1,07` o densidad del gradiente de agua activo) y `z_0` (tope de las pruebas MDT incluidas, con `P_0 = 0` o anclado a la primera prueba para centrar en `0 psi`). Las rectas de fluido ya ajustadas se proyectan exactas al espacio de exceso (`dP_ex/dz = (ρ_fluido − ρ_ref)·g`), manteniendo idéntica la profundidad de intersección de contactos!
  3. **Detección visual/tabular de saltos entre tramos:** informa en el panel el EMW medio por zona y cuándo una regresión zonal da densidad aparente no física (`> 1,25 g/cm³`, como los `1,69 g/cm³` de la Zona D del TP) sugiriendo compartimentalización / sobrepresión escalonada.
- **ADR previo (`docs/decisiones/`):** fijar definición exacta de `P_ex` y `EMW` (y advertencia explícita cuando `z` es MD sin TVD o datum de superficie no verificado), preservación de ajustes en presión absoluta y persistencia opcional del modo visual en `project.display.overlays` (como el color por *drawdown* de PR #107) para que pista y figura PNG/SVG/PDF exporten igual.
- **Mapa confirmado en código:**
  - `src/petro/pressure.ts` y `src/petro/gradients.ts`: agregar funciones puras de exceso de presión, proyección lineal de `TrendCoefficients` a exceso y cálculo de EMW con tests analíticos (verificar que la intersección de dos rectas en `P_ex` da el mismo contacto al milímetro que en `P`).
  - `src/modules/mdt/model.ts`, `dock.tsx`, `overlay.ts` y `src/app/export/figureSources.ts`.
- **Terminado cuando:** alternar entre `Presión` y `Exceso de presión` conserva exactamente gradientes, densidades de fluido y contactos; un acuífero con `ρ = ρ_ref` se dibuja vertical (`pendiente 0`); en el pozo del TP se aprecian con claridad la sobrepresión (~`14,5 lb/gal` / `1,74 g/cm³` EMW) y los escalones de la Zona D; figura exportable consistente en claro y oscuro.

---

### G06 — Rayos Gamma sin Uranio (`CGR`) conectado a `IGR` / `Vsh`
- **Qué hace:** aprovecha `THOR` (ppm), `POTA` (%) y `URAN` (ppm) del CSV del TP para separar la radiactividad de arcillas/feldespatos de la del uranio (materia orgánica, fracturas, sales diagenéticas):
  1. Módulo puro `src/modules/cgr/` que produce `CGR` (rol `CGR`, gAPI equivalente sin uranio) y `U_GR_FRAC` (fracción del GR atribuible al uranio, `0–1`), y un segundo módulo `src/modules/igr-cgr/` que produce el puerto `IGR` desde `CGR` con parámetros propios `cgrClean` y `cgrShale` por zona (así el usuario puede elegir en el paso Arcilla si `IGR` sale de `GR` total o de `CGR`, y comparar ambos con `compare` o Snapshots + Cortina sin tocar `igr` clásico!).
  2. **Sin inventar constantes de sarta:** ofrece dos modos transparentes en parámetros de `cgr`:
     - `Ajustado en el pozo` (por defecto cuando están las 4 curvas `GR`, `THOR`, `POTA`, `URAN`): ajusta por mínimos cuadrados ordinarios sin intercepto `GR ≈ a·THOR + b·POTA + c·URAN` en muestras válidas del pozo (informando `a, b, c`, `R²` y `RMSE` en una tabla de diagnóstico `CGR_CALIBRATION`; si `R² < 0,85` o algún coeficiente no es positivo, avisa incoherencia), y define `CGR = a·THOR + b·POTA` (y opcionalmente `GR − c·URAN` recortado a `≥ 0`).
     - `Coeficientes estándar orientativos` (p. ej. `4·THOR + 16·POTA`, carta Schlumberger NGS orientativa, cuando un pozo trae `THOR` y `POTA` pero no `GR` o `URAN`), con aviso explícito de que dependen del fabricante.
- **ADR previo (`docs/decisiones/`):** justificar la separación en `cgr` + `igr-cgr` (preserva defaults del recorrido de réplica del TP: `igr` sigue primero en `MODULES` como fuente por defecto de `IGR`), el ajuste empírico `GR ~ Th + K + U` frente a constantes fijas de herramienta desconocida y los guardas de dominio.
- **Mapa confirmado en código:**
  - Nueva función pura `src/petro/spectralGr.ts` + tests en `tests/petro-spectral-gr.test.ts` (contra regresión exacta conocida y datos reales del TP).
  - Nuevos módulos `src/modules/cgr/index.ts` y `src/modules/igr-cgr/index.ts`, registrados en `src/modules/index.ts` **después** de `igr` para no alterar la fuente por defecto de `IGR`.
- **Terminado cuando:** el recorrido de réplica del TP por defecto no cambia ni un decimal (`igr` sigue activo por defecto); al elegir `igr-cgr` como fuente de `IGR` (o activar comparar), se ve `CGR` vs `GR` y el impacto en `VSH`, `PHIE` y `NET_PAY`; `CGR_CALIBRATION` reporta `R²` y `RMSE` sobre las 5.810 muestras del TP; documentado en Ecuaciones.

---

### G07 — Hidrocarburo Móvil vs. Residual (`Sxo`, `MOS`, `Rt–Rxo` y pista volumétrica)
- **Qué hace:** cierra la cadena de resistividad conectando la salida `RXO` de `invasion-step` con la evaluación de movilidad de hidrocarburos (práctica «Rt vs. Rxo y contactos» de la cátedra):
  1. **Motor puro (`src/petro/movability.ts`):** calcula por muestra `SXO` (saturación de la zona lavada), `MOS = max(0, SXO − SW)` (fracción de hidrocarburo desplazado por el filtrado dentro del espacio poral), `SHR = 1 − SXO` (saturación de hidrocarburo residual) y `MHI = SW / SXO` (índice de movilidad de hidrocarburos: `< 0,7` hidrocarburo móvil típico en areniscas, `≈ 1` sin desplazamiento). Soporta dos métodos explícitos:
     - **Método de cocientes (`ratio`, sin porosidad):** `SW / SXO = ((RXO / RT) / (Rmf / Rw))^(1/n)` → `SXO = min(1, SW / ((RXO/RT)/(Rmf/Rw))^(1/n))`, ideal cuando no se conoce `Rmf` por separado sino el cociente empírico `k_w = (RXO / RT)_agua = Rmf / Rw` leído en zona acuífera.
     - **Archie en zona lavada (`archie-rxo`):** `SXO = min(1, (a · Rmf / (φ^m · RXO))^(1/n))` cuando el intérprete declara `Rmf`.
  2. **Módulo `src/modules/movable-hc/`:** consume `SW`, `PHIE`, `RXO` y `RT` opcional; parámetros `method` (`ratio` por defecto | `archie`), `rmfOverRw` (por zona, ajustable también desde el gráfico) y `rmf`, compartiendo `a, m, n` de `SHARED_PARAMS`; publica curvas `SXO`, `MOS`, `SHR`, `MHI` y tabla resumen por zona (`MOVABLE_SUMMARY`: `% muestras con invasión resuelta`, `Sw medio`, `Sxo medio`, `MOS medio`, `fracción móvil del hidrocarburo (MOS / (1 − Sw))`).
  3. **Plantilla de Crossplot «Movilidad Rt–Rxo (Ratio Plot)»:** log `RXO` vs. log `RT` coloreado por `SW` o `GR`, con la recta de agua `RXO = (Rmf/Rw)·RT` **arrastrable** para calibrar `rmfOverRw` directamente sobre las arenas mojadas (usando el mecanismo de `src/plots/crossplot/drag.ts` como Pickett) y líneas guía de `Sw/Sxo = 0,7` y `0,5`.
  4. **Partición en la pista volumétrica (`VOLUMETRIC_STACK`):** aprovechar el soporte jerárquico ya existente en `src/viewer/stack.ts` (donde si falta un hijo o es `NaN` el padre `hydrocarbon` se dibuja entero!) o una opción de pila para mostrar `Hidrocarburo móvil` (`PHIE · MOS`) + `Hidrocarburo residual` (`PHIE · (1 − SXO)`) donde `SXO` tiene dato y `SW < SXO`.
- **ADR previo (`docs/decisiones/`):** definir ecuaciones, recortes físicos (`SXO ∈ [SW, 1]` cuando el filtrado acuoso desplaza hidrocarburo, avisando si `SXO < SW`), arrastre de `rmfOverRw` en el crossplot y compatibilidad con `VOLUMETRIC_STACK` sin alterar pozos sin `RXO`.
- **Mapa confirmado en código:**
  - `src/modules/invasion-step/index.ts` (ya publica rol `RXO` y `RT`), `src/modules/sharedParams.ts`.
  - `src/plots/crossplot/templates.ts`, `params.ts`, `drag.ts` y `src/core/plots.ts`.
  - `src/viewer/stack.ts` y `src/viewer/templates.ts` (`VOLUMETRIC_STACK`).
- **Terminado cuando:** casos de libro de Asquith & Krygowski (cap. 6, Ratio Method y `Sxo` de Archie) pasan al milésimo en Vitest; arrastrar la línea de agua en `Rt–Rxo` actualiza `rmfOverRw` en un solo `commit` deshacible; en muestras con `RXO = NaN` la pista volumétrica dibuja el hidrocarburo entero sin huecos falsos; capturas claro/oscuro en el pozo del TP.

---

### G08 — Panel de «Coherencia Cruzada entre Herramientas» (Semáforo para la defensa)
- **Qué hace:** módulo de panel de solo lectura (`PANEL_MODULES`, id `'cross-check'`, pestaña en el dock / acceso desde Sumario y comando en la paleta, más sección opcional en el Informe y en `chatContext`) que audita en vivo la **consistencia física entre mediciones independientes** zona por zona, sin recalcular petrofísica ni tocar contratos del motor:
  1. **Archie (`SW`) vs. SCAL (`SWI`):** lee `SWI_ZONES` / curvas `SW` y `SWI`; marca verde si `< 5 %` del *pay* tiene `Sw < Swi − tol`, amarillo `5–20 %`, rojo `> 20 %`, con enlace directo al panel SCAL y al tramo más crítico.
  2. **Agua ligada: Archie (`BVW`) vs. RMN (`BVI_NMR`) vs. SCAL (`PHIE·SWI`):** en reservorio neto compara medianas por zona; detecta y explica discrepancias sistemáticas (como el corte fijo de 33 ms del CMR sobreestimando `BVI` frente a SCAL/MICP en el TP, documentado en `0087`).
  3. **Porosidad: Perfil (`PHIE`) vs. RMN (`PHIE_NMR`) vs. Corona:** resume sesgo/déficit por zona distinguiendo derrumbes (`IND_WASHOUT`), efecto de gas/fluido (`IND_NMR_DEFICIT`) o desajuste de matriz.
  4. **Contactos MDT vs. Saturación del perfil:** si hay contactos MDT válidos en el pozo, verifica si existen muestras de `NET_PAY` por debajo del contacto de agua (`OWC`/`GWC` + margen) o arenas limpias acuíferas (`Sw > 0,8`) por encima.
  5. **Capacidad de sello vs. columna (si hay curvas MICP o tabla SCAL `Pd`):** estima la columna máxima retenible `h_max = P_{d,res} / (Δρ · g)` con las muestras de mayor `Pd` (declarando explícitamente los supuestos de `σ·cosθ` y `Δρ` vigentes del panel MICP) y avisa si es dato medido o sin soporte de sello.
  6. **Efecto de Uranio y Movilidad (si G06/G07 están activos):** informa cuánto del `GR` proviene de uranio (`U_GR_FRAC`) y qué fracción del hidrocarburo en *pay* muestra movilidad (`MOS / Sh`) donde hay invasión resuelta.
- **ADR previo (`docs/decisiones/`):** fijar la matriz de chequeos, sus estados (`acuerdo` | `atención` | `tensión` | `sin soporte`, nunca ocultando cuando falta un ensayo) y justificar que los umbrales del semáforo son criterios operativos de auditoría declarados en pantalla y en Ecuaciones, no leyes universales.
- **Mapa confirmado en código:**
  - `src/modules/index.ts` (`PANEL_MODULES`), `src/modules/micp/` como modelo de módulo de panel puro (`model.ts` sin React + `dock.tsx` + `index.ts` con `docs`).
  - `src/app/report/report.ts` y `src/app/chatContext/chatContext.ts` (opción para incluir resumen de coherencia cruzada).
- **Terminado cuando:** el modelo puro (`src/petro/crossCheck.ts` o `src/modules/cross-check/model.ts`) está 100 % testeado con escenarios sintéticos de acuerdo, tensión `Sw < Swi`, divergencia CMR–SCAL e incoherencia de contacto MDT; cada fila en la UI salta al visor o abre el panel involucrado con un clic; en el pozo del TP resume con claridad las hallazgos reales de las zonas A–E; capturas claro/oscuro.
