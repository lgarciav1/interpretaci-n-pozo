# 0092 — Panel de «Coherencia Cruzada entre Herramientas» (`cross-check`)

Fecha: 2026-11-26. Sigue a la 0055 (`swi-pc` SCAL), la 0058 (módulos de panel en `PANEL_MODULES`), la 0087 (curvas MICP y calibración del CMR), la 0090 (`CGR` / `U_GR_FRAC`) y la 0091 (`Sxo` / `MOS`).

## Contexto

A lo largo de la interpretación de un pozo coexisten mediciones independientes (perfiles eléctricos y nucleares, resonancia magnética CMR, plugs de corona, presiones MDT, ensayos SCAL/MICP, GR espectral e invasión radial `Rxo`). Hasta ahora cada herramienta vive en su propio panel y el intérprete debe cruzarlas a mano para detectar tensiones físicas en la defensa: `Sw` de Archie por debajo de la irreducible `Swi` de SCAL, sobreestimación del agua ligada del CMR por el corte fijo de $T_2 = 33\text{ ms}$ frente a SCAL/MICP, sesgos entre porosidad de perfil, RMN y corona, inconsistencias entre contactos MDT y el *pay* calculado, capacidad capilar de sello frente a la columna de hidrocarburo, aporte de uranio al `GR` o hidrocarburo sin movilidad desplazable.

Se requiere una auditoría de solo lectura en vivo que contraste estas fuentes zona por zona sin recalcular petrofísica ni alterar ningún contrato ni salida por defecto del motor.

## Decisión

### 1. Arquitectura y ubicación

- **Motor de auditoría puro (`src/petro/crossCheck.ts`):** funciones puras sobre arreglos numéricos ya calculados, zonas, plugs, contactos MDT y presiones de desplazamiento `Pd`, sin React, sin stores y sin mutar ninguna entrada. Reutiliza funciones petrofísicas ya validadas (`swBelowSwiFlag` de `src/petro/swiPc.ts`, `entryHeightM` y `SYSTEM_HG_AIR` de `src/petro/micp.ts`).
- **Módulo de panel (`src/modules/cross-check/`):** registrado en `PANEL_MODULES` (`src/modules/index.ts`, id `'cross-check'`, categoría `'summary'`, espacios `'petrophysics'` y `'geology'`).
  - `index.ts`: `definePanelModule` puro con documentación y ecuaciones exclusivamente en `docs` (nunca en la interfaz).
  - `model.ts`: adaptador puro desde `Well` + `Interpretation` + `ClientResult` hacia `evaluateCrossCheck`, más formateadores puros para el Informe HTML y `chatContext`.
  - `dock.tsx` y `cross-check.css`: pestaña «Coherencia» en el dock con vista de semáforo zona por zona, tarjetas de resumen (incluyendo capacidad de sello), y acciones de navegación de un clic hacia el tramo crítico en el visor (`useTrendsUi.getState().requestRange`) y hacia el panel o inspector del módulo involucrado (`scal`, `micp`, `core-calibration`, `mdt`, `cgr`, `movable-hc`).
  - `commands.ts`: acción en la paleta de comandos (`cross-check:open`), más botón de acceso directo desde el panel de Sumario (`src/modules/zone-summary/panel.tsx`).
- **Informe y contexto para chat:** opción `includeCrossCheck` (activa por defecto) en `ReportOptions` (`src/app/report/report.ts` y `ReportPanel.tsx`) y en `ChatContextOptions` (`src/app/chatContext/chatContext.ts`), mostrando el semáforo resumido y los hallazgos principales sin recalcular petrofísica y respetando el presupuesto de caracteres de `chatContext`.

### 2. Estados del semáforo (cuatro estados explícitos)

Todo chequeo produce uno de cuatro estados (`CrossCheckStatus`):

| Código | Etiqueta UI | Tono | Significado |
|---|---|---|---|
| `ok` | Acuerdo | `ok` (verde) | Las herramientas disponibles coinciden dentro de la banda operativa declarada. |
| `warn` | Atención | `warn` (amarillo) | Discrepancia moderada, zona de transición o soporte parcial que amerita revisión. |
| `tension` | Tensión | `error` (rojo) | Contradicción física fuerte entre herramientas o parámetros incompatibles. |
| `unsupported` | Sin soporte | `neutral` (gris) | Faltan curvas, ensayos o muestras en el intervalo; nunca se oculta ni se disfraza de verde. |

### 3. Matriz de chequeos y criterios operativos

Los siete chequeos (que cubren las seis familias de auditoría, separando Uranio y Movilidad para no mezclar diagnósticos opuestos en una misma celda) son:

1. **Archie (`SW`) vs. SCAL (`SWI`) (`sw-vs-swi`):**
   - Ámbito por zona: muestras con `NET_PAY = 1` y ambos (`SW`, `SWI`) finitos (si no existe `NET_PAY`, se evalúa sobre todas las muestras válidas con nota explícita; si una zona tiene 0 muestras de *pay*, queda en `sin soporte` mostrando como contexto el porcentaje en la zona si existiera).
   - Métrica: porcentaje de muestras con $S_w < S_{wi} - \varepsilon$ (`swBelowSwiFlag`, con la tolerancia $\varepsilon$ vigente de `swi-pc` en la zona, por defecto $0{,}02\text{ v/v}$).
   - Umbrales operativos: `< 5 %` → `ok`, `5–20 %` → `warn`, `> 20 %` → `tension`.
   - Navegación: panel `SCAL` y salto al tramo donde $S_{wi} - S_w$ es máximo.

2. **Agua ligada: Archie (`BVW`) vs. RMN (`BVI_NMR`) vs. SCAL (`PHIE·SWI`) (`bound-water`):**
   - Ámbito por zona: reservorio neto (`NET_RES = 1`; respaldo: todas las válidas si falta `NET_RES`). Requiere al menos 2 de las 3 estimaciones con muestras válidas; si no, `sin soporte`.
   - Métrica: medianas (P50) por zona de `BVW`, `BVI_NMR` y `BVI_SCAL = PHIE · SWI`. Si hay curvas MICP cargadas, cita además el cociente CMR/MICP en la calibración de 100 psi aire–salmuera (ADR 0087).
   - Umbrales operativos:
     - Sobreestimación del CMR (corte fijo de $T_2 = 33\text{ ms}$): `tension` si $\text{BVI}_{\text{RMN}} / \text{BVI}_{\text{SCAL}} \ge 1{,}5$ con diferencia $\ge 0{,}03\text{ v/v}$, o $\text{BVI}_{\text{RMN}} - \text{BVW} \ge 0{,}04\text{ v/v}$; `warn` si cociente $\ge 1{,}25$ con diferencia $\ge 0{,}015\text{ v/v}$, o $\text{BVI}_{\text{RMN}} - \text{BVW} \ge 0{,}02\text{ v/v}$.
     - Archie por debajo de SCAL: `tension` si $\text{BVW} - \text{BVI}_{\text{SCAL}} \le -0{,}03\text{ v/v}$; `warn` si $\le -0{,}015\text{ v/v}$.
     - Agua libre/móvil (`BVW` claramente superior al agua ligada SCAL o RMN): `warn` si $\text{BVW} - \text{BVI}_{\text{SCAL}} \ge 0{,}04\text{ v/v}$ (o respecto de `BVI_NMR` cuando falta SCAL), explicando la presencia de agua móvil o transición capilar.
     - En otro caso: `ok`.
   - Navegación: panel `Análisis MICP` (si hay curvas MICP) o `SCAL`, y salto al tramo de mayor discrepancia.

3. **Porosidad: Perfil (`PHIE`) vs. RMN (`PHIE_NMR`) vs. Corona (`core.phi`) (`porosity`):**
   - Ámbito por zona: `PHIE` comparado con `PHIE_NMR` (muestras válidas de la zona) y/o plugs de corona incluidos en la zona (con su puesta en profundidad aplicada y ventana `±0,15 m`). Si faltan ambas referencias independientes → `sin soporte`.
   - Métricas: mediana de $\Delta\phi_{\text{RMN}} = \phi_{e,\text{RMN}} - \phi_e$, sesgo mediano $\operatorname{mediana}(\phi_e - \phi_{\text{corona}})$, y porcentajes de `IND_WASHOUT` e `IND_NMR_DEFICIT` en las muestras comparadas.
   - Umbrales operativos: `ok` si $|\text{sesgo}| \le 0{,}02\text{ v/v}$ en todas las referencias disponibles y déficit RMN `< 15 %`; `warn` si algún $|\text{sesgo}| \in (0{,}02,\ 0{,}04]\text{ v/v}$ o déficit en `[15 %, 35 %]`; `tension` si algún $|\text{sesgo}| > 0{,}04\text{ v/v}$ o déficit `> 35 %`.
   - Atribución diagnóstica (cuando hay atención/tensión): prioriza derrumbe de pozo (`IND_WASHOUT ≥ 15 %`), luego efecto de gas/hidrocarburo liviano o microporosidad (`IND_NMR_DEFICIT ≥ 15 %` o sesgo RMN `< −0,02 v/v`), y por último desajuste de matriz/densidad de grano ($\rho_{ma}$).
   - Navegación: panel `Calibración` (corona) o inspector de `nmr-fluids`, y salto al tramo de mayor desvío.

4. **Contactos MDT vs. Saturación del perfil (`mdt-vs-sw`):**
   - Ámbito por zona: toma contactos agua–hidrocarburo válidos (`OWC` o `GWC` con profundidad finita) desde `mdtAnalysis`, asignados únicamente a las zonas del compartimiento que intersectan sus gradientes o la profundidad del contacto (evitando extrapolar un contacto entre compartimientos con distinto régimen de presión). Sin contacto válido aplicable → `sin soporte`.
   - Métrica (margen operativo $\delta_z = 2{,}0\text{ m}$): espesor de `NET_PAY` por debajo de $z_c + \delta_z$ y espesor/porcentaje de arenas limpias acuíferas (`NET_RES = 1` —o `VSH ≤ 0,35 ∧ PHIE ≥ 0,08`— con `SW > 0,80`) por encima de $z_c - \delta_z$.
   - Umbrales operativos: `ok` si no hay *pay* por debajo y las arenas limpias acuíferas arriba son `< 5 %` y `< 1,0 m`; `warn` si el *pay* debajo es `≤ 1,5 m` (y `≤ 10 %` del *pay* de la zona) o las arenas limpias arriba están en `5–20 %` o `1,0–3,0 m` (advirtiendo zona de transición capilar sobre el FWL); `tension` si hay `> 1,5 m` (o `> 10 %`) de *pay* debajo del contacto, o `> 20 %` y `> 3,0 m` de arena limpia acuífera por encima.
   - Navegación: panel `Presiones MDT` y salto al tramo contradictorio o al contacto.

5. **Capacidad de sello vs. columna (`seal-capacity`):**
   - Fuente: presiones de desplazamiento $P_{d,\text{lab}}$ (psi Hg–aire) desde las curvas MICP cargadas en el pozo (ajuste de Thomeer o entrada medida de respaldo) o tabla SCAL `Pd` (kg/cm² convertido con `KGF_CM2_TO_PSI`). Se convierten a reservorio con `entryHeightM` (`src/petro/micp.ts`) usando explícitamente el sistema interfacial $(\sigma\cos\theta)_{\text{res}}$ y contraste de densidades $\Delta\rho = \rho_w - \rho_{hc}$ vigentes en `interpretation.moduleState['micp']`.
   - Regla de honestidad sobre soporte de sello: se distingue explícitamente si las muestras de mayor $P_d$ pertenecen a una zona de sello (`kind === 'seal'` o bandera `isSeal`) o provienen únicamente de plugs de reservorio.
     - Sin muestras MICP/SCAL o con $\Delta\rho \le 0$ → `sin soporte`.
     - Muestras solo en reservorio (sin ensayos medidos de roca sello) → informa $h_{\max}$ como cota inferior de las capas más apretadas del reservorio, declara los supuestos $(\sigma, \theta, \Delta\rho)$ y marca `warn` con aviso explícito «sin soporte directo de sello».
     - Con muestras medidas de sello y columna $h_{\text{col}}$ (desde FWL/MDT o espesor de *pay* observado): `ok` si $h_{\max} \ge 1{,}2\,h_{\text{col}}$, `warn` si $h_{\text{col}} \le h_{\max} < 1{,}2\,h_{\text{col}}$, `tension` si $h_{\max} < h_{\text{col}}$; sin $h_{\text{col}}$ conocida → `ok` (dato medido de sello).
   - Navegación: panel `Análisis MICP` (o `SCAL`) y salto a la profundidad de la muestra determinante.

6. **Efecto de uranio en GR (`uranium-gr`, si G06 está activo):**
   - Ámbito por zona: mediana y P90 de `U_GR_FRAC` en reservorio neto (o toda la zona si falta `NET_RES`). Sin curva `U_GR_FRAC` válida → `sin soporte`.
   - Umbrales operativos: `ok` si mediana `< 15 %` y `< 20 %` de muestras superan `25 %`; `warn` si mediana en `[15 %, 30 %]` o `≥ 20 %` de muestras superan `25 %` (o mediana `> 30 %` ya mitigada con `igr-cgr` como fuente activa de `IGR`); `tension` si mediana `> 30 %` mientras `IGR` sigue calculándose desde `GR` total.
   - Navegación: módulo `cgr` / `igr-cgr` y salto al pico de uranio en la zona.

7. **Movilidad del hidrocarburo en *pay* (`hc-movability`, si G07 está activo):**
   - Ámbito por zona: muestras de `NET_PAY` con invasión resuelta (`MOS` y `SW` finitos), calculando cobertura resuelta, fracción móvil ponderada por volumen poral $f_{\text{móvil}} = \sum h_i\phi_{e,i}\text{MOS}_i / \sum h_i\phi_{e,i}(1 - S_{w,i})$ y `MHI` mediano. Sin `MOS`, sin *pay* o sin muestras resueltas → `sin soporte`.
   - Umbrales operativos: `ok` si $f_{\text{móvil}} \ge 30\,\%$ y cobertura resuelta $\ge 20\,\%$; `warn` si $f_{\text{móvil}} \in [10\,\%, 30\,\%)$ o cobertura `< 20 %`; `tension` si $f_{\text{móvil}} < 10\,\%$ con invasión resuelta (hidrocarburo mayormente residual o `Rmf/Rw` / tipo de lodo a revisar).
   - Navegación: módulo `movable-hc` y salto al tramo de *pay*.

## Límites científicos

- **Criterios operativos, no leyes universales:** los umbrales del semáforo (`5 % / 20 %`, `0,02 / 0,04 v/v`, `1,25× / 1,5×`, `±2 m`, `1,2× h_col`, `15 % / 30 %`, `10 % / 30 %`) son referencias prácticas de auditoría para priorizar la revisión técnica durante el análisis y la defensa. Se declaran explícitamente en la interfaz y en Ecuaciones; no sustituyen el criterio petrofísico ni certifican una interpretación.
- **Solo lectura sobre resultados vigentes:** el panel audita las salidas activas de la cadena y los conjuntos de puntos cargados; no recalcula `Sw`, `φe` ni gradientes propios ni sobrescribe decisiones del usuario.
- **Capacidad de sello dependiente de supuestos:** el paso de $P_d$ mercurio–aire a altura de columna depende de los valores de $(\sigma, \theta)$ y $\Delta\rho$ vigentes en el panel MICP (a menudo supuestos en ausencia de PVT/IFT medidos) y de que las muestras pertenezcan realmente a la roca sello.

## Alternativas descartadas

- **Implementarlo como módulo de cálculo en `MODULES` (Web Worker):** los chequeos cruzan `Well.pointSets` (corona, MDT, MICP), `Interpretation.trends` (contactos MDT) y `Interpretation.moduleState['micp']`, que no forman parte de `EngineWell`. Duplicar esos datos en el grafo del motor rompería el aislamiento del Worker sin beneficio alguno, ya que la auditoría no produce curvas para otros módulos.
- **Ocultar los chequeos sin ensayo o agruparlos en un puntaje numérico único:** ocultaría huecos de información críticos en la defensa (p. ej. ausencia de contactos MDT o de muestras MICP en el sello) y un índice compuesto enmascararía contradicciones puntuales severas.
