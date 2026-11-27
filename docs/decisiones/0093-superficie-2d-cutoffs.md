# 0093 — Superficie 2D de estabilidad de Cutoffs (`φ_min × Sw_max`, `Vsh × φ`, `Vsh × Sw`) (G09)

Fecha: 2026-11-27. Sigue a la 0007 (`cutoff-sensitivity`, C20) y la 0054 (corte de permeabilidad y `NET_SAND`).

## Contexto

Los barridos 1D de `cutoff-sensitivity` muestran cuánto cambia el *net pay* o el volumen *in situ* al variar un cutoff dejando los otros dos fijos. Sin embargo, cuando dos cortes interactúan —especialmente `φ_min × Sw_max` (efectos de borde en arenas limpias de baja porosidad o transición agua–hidrocarburo), `Vsh_max × φ_min` (intercalaciones arcillosas) y `Vsh_max × Sw_max`— una curva 1D no distingue si el punto operativo descansa sobre una **meseta estable** o al borde de un **barranco** donde pequeñas variaciones simultáneas de dos umbrales colapsan el espesor neto y los volúmenes declarados.

Al mismo tiempo, el test de rendimiento del worker (`tests/modules-6a-sensitivity.test.ts`) exige que la ejecución de `cutoff-sensitivity` en el motor se mantenga por debajo de `20 ms` sobre pozos completos.

## Decisión

### 1. Cómputo bajo demanda en el panel (sin alterar `compute()` ni el worker)

- **Se mantienen intactos** `cutoffSweep`, `sweepThresholds`, `cutoff-sensitivity/index.ts:compute()` y los contratos de salida `CUTOFF_SWEEP`. El presupuesto de `< 20 ms` del worker no se toca.
- **Motor puro (`src/petro/sensitivity.ts`):** se añaden las primitivas puras para la superficie 2D, las curvas de nivel y la estabilidad local bivariada, reutilizando `sweepThresholds`, `firstAtLeast`, `lastAtMost` y `hasPermCutoff`.
- **Adaptador puro (`src/modules/cutoff-sensitivity/surfaceModel.ts`):** resuelve `VSH`, `PHIE`, `SW` y `PERM` (opcional) con paridad exacta respecto al motor (`ClientResult` + `Well` con conversión canónica de unidades), calcula la superficie 2D para la zona activa, `Total` (sumando zonas con su respectivo fluido, área, `Bo`/`Bg`, *overrides* por zona y exclusión de volumen en zonas `seal`) o `Pozo completo`, extrae los contornos y evalúa la estabilidad local. No importa React ni stores, de modo que `tests/modules.test.ts` sigue pasando sin modificaciones.

### 2. Barrido exacto 2D en $O(N + n_x n_y)$

Para cualquier par $(x, y)$ entre `('phi', 'sw')`, `('vsh', 'phi')` o `('vsh', 'sw')` con grillas $X$ de tamaño $n_x$ e $Y$ de tamaño $n_y$:

1. Cada muestra $i$ válida (con espesor $h_i > 0$ e índice dentro de los tramos `ranges`) que pasa los cortes fijos no barridos (el tercer cutoff y, si está activo, $k \ge k_{\min}$) cae en exactamente una celda $(i_x, j_y)$ de la matriz 2D acumulada usando las reglas inclusivas exactas:
   - Para `vsh` o `sw` ($\le$ umbral): el menor índice $p$ tal que $t_p \ge \text{valor}$ (`firstAtLeast`). Si ningún umbral de la grilla pasa, se descarta. Si el valor es `NaN`:
     - Si la variable `NaN` está en el filtro de reservorio (`vsh` o `phi`), solo descarta las muestras ya rechazadas por el corte conocido fijo; si ninguna curva conocida descarta la muestra, la marca como reservorio sin dato (no se suma en `netPay`/`hphiShPay`, y hace que el nodo resulte `NaN` cuando todas las muestras clasificables caen sin dato).
     - Si la variable `NaN` es `sw`, las muestras que pasan reservorio (`Vsh`, `φ` y `k`) suman en `noDataPay` en lugar de `netPay`; el nodo es `NaN` solo si `resN > 0` y `knownN === 0` (exacta paridad con `cutoffSweep` y `netFlagsInto`).
   - Para `phi` ($\ge$ umbral): el mayor índice $p$ tal que $t_p \le \text{valor}$ (`lastAtMost`).
2. Con una pasada 2D de sumas acumuladas (prefijo/sufijo según la dirección $\le$ o $\ge$ de cada eje), las matrices `netRes`, `netPay`, `hphiShPay` y `noDataPay` de longitud $n_x \times n_y$ (indexadas en fila mayor `j * nx + i`) coinciden con `cutoffSweep` y `netFlagsInto` dentro de precisión de punto flotante ($\le 10^{-12}$), en tiempo $O(N + n_x n_y)$ (~1–3 ms para la grilla por defecto de $41 \times 41$ puntos —pasos $0{,}01$ en $\varphi$ y $0{,}025$ en $V_{sh}/S_w$— sobre 5 810 muestras).
3. El eje horizontal siempre representa `x` y el vertical `y`:
   - `phi-sw`: `φ_min` (X) × `Sw_max` (Y) *(por defecto)*
   - `vsh-phi`: `Vsh_max` (X) × `φ_min` (Y)
   - `vsh-sw`: `Vsh_max` (X) × `Sw_max` (Y)

### 3. Curvas de nivel (*Marching Squares*) y muestreo bilineal

- `contourLevelsForRange(min, max, targetCount)`: usa pasos limpios ($\{0{,}5,\,1,\,2,\,2{,}5,\,5,\,10,\,20\} \times 10^k$) para elegir entre 3 y 6 niveles estrictamente interiores al rango finito observado.
- `extractContours2D(grid, values, levels)`: aplica *Marching Squares* uniendo segmentos adyacentes en polilíneas cerradas o abiertas. Toda celda con al menos un vértice `NaN` o no finito se omite por completo (no se interpola a través de zonas sin dato). Los casos ambiguos de silla (`5` y `10`) se desambiguan con el promedio de los 4 vértices respecto al nivel `level`.
- `sampleSurface2D(grid, values, x, y)`: interpola bilinealmente sobre los vértices con peso activo no nulo ($w > 0$) de la celda, o devuelve `NaN` fuera del dominio o si algún vértice activo es `NaN`.

### 4. Semáforo operativo de estabilidad local bivariada

Alrededor de los cutoffs vigentes (con los otros cortes fijos en sus valores vigentes), se define una caja operativa acotada a las grillas físicas $[x_{\min}, x_{\max}] \times [y_{\min}, y_{\max}]$ con semiamplitudes fijas (`CUTOFF_STABILITY_HALF`):

- `ΔVsh = 0,05 v/v`
- `Δφ = 0,01 v/v`
- `ΔSw = 0,05 v/v`

Se evalúa exactamente el **centro vigente** (y en vista `Total` con *overrides* por zona en el par barrido, cada zona se evalúa con sus propios cutoffs vigentes desplazados por $(\pm\Delta x, \pm\Delta y)$ para conservar paridad total con `ZONE_SUMMARY` y `VOLUMETRICS`) y las **4 esquinas** de la caja operativa para la métrica activa (`netPay`, `h·φ·Sh`, `Petróleo` o `Gas`):

$$\delta_{\max} = \frac{\max_{k \in \{\text{esquinas}\}} |M_k - M_0|}{\max(|M_0|, \varepsilon)}$$

- **Estable (Meseta)** (`stable`, verde `ok`): $\delta_{\max} \le 10\,\%$
- **Sensible (Transición)** (`sensitive`, amarillo `warn`): $10\,\% < \delta_{\max} \le 25\,\%$
- **Crítico (Barranco)** (`critical`, rojo `error`): $\delta_{\max} > 25\,\%$
- **Sin base nula / Sin dato** (`empty` / `no-data`, neutro): cuando el centro es $0$ y al menos una esquina sube (`edge`) o todas las muestras carecen de dato (`no-data`), evitando divisiones por cero espurias o diagnósticos falsos.

La evaluación exacta de las 4 esquinas mediante `cutoffSurface2D` acotado a 1 punto o evaluación exacta directa evita depender de la discretización de la grilla de visualización.

### 5. Interfaz y deshacer atómico (`Ctrl+Z`)

- `src/modules/cutoff-sensitivity/panel.tsx` incorpora un `SegmentedControl` superior (`Curvas 1D | Superficie 2D`, valor por defecto `'1d'`) conservando el selector de zona (`Total` / zona), fluido cuando hay petróleo y gas, y todas las gráficas 1D sin cambios.
- La vista 2D muestra: selector de par (`φ × Sw`, `Vsh × φ`, `Vsh × Sw`), selector de métrica (`Neto pay`, `h·φ·Sh`, y `Petróleo` / `Gas` cuando aplica), chip resumen de los cortes fijos, tarjeta semántica de estabilidad local con `Badge` (sin ecuaciones en UI; las ecuaciones van en `cutoff-sensitivity/index.ts:docs`), y un lienzo interactivo `<canvas>` con:
  - mapa de calor secuencial adaptado al tema claro/oscuro desde tokens de `src/ui/tokens.ts` y sombreado rayado en celdas `NaN`;
  - contornos rotulados de *Marching Squares*;
  - caja punteada del entorno operativo ($\pm\Delta x, \pm\Delta y$) y mira arrastrable con soporte completo de teclado (`Arrow*`, `Shift+Arrow*` con paso fino/grueso, `Escape` y pérdida de captura para cancelar el estado local del arrastre sin emitir cambios);
  - un único commit atómico (`useProject.getState().commit(...)` con `setParam` encadenado sobre `Project`) al soltar el arrastre o confirmar un paso de teclado para que `Ctrl+Z` revierta ambos parámetros a la vez.

## Consecuencias

- Las herramientas existentes (`CUTOFF_SWEEP`, `worker`, `SummaryCompare`, informe HTML y tests previos) conservan compatibilidad total y el presupuesto de `< 20 ms`.
- En el panel de sensibilidad a los cutoffs, el usuario puede alternar en un clic entre barridos 1D y mapa 2D para defender con números concretos si el par seleccionado vive en una meseta petrofísica o al filo de un barranco.
