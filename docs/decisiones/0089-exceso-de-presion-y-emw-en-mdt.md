# 0089 — Exceso de presión y densidad equivalente (EMW) en Presiones MDT

Fecha: 2026-11-25. Sigue a la 0008 (tendencias y gradientes), la 0009 (presiones MDT y conjuntos de puntos), la 0012 (exportación de figuras) y la 0057 (MDT y SCAL del TP embebidos).

## Contexto

En reservorios profundos o sobrepresionados, graficar únicamente presión absoluta in situ $P(z)$ contra profundidad comprime visualmente los pequeños cambios de pendiente entre fluidos y los saltos de presión entre compartimentos. En el pozo del TP (58 pruebas MDT entre `7.729` y `8.121 m`, presiones entre `19.126` y `19.816 psi`, sobrepresión cercana a `14,5 lb/gal` / `1,74 g/cm³`), los escalones de `35–55 psi` dentro de la Zona D aparecen como ligeras inflexiones sobre una diagonal pronunciada y una regresión lineal única de toda la zona produce una densidad aparente no física de `1,69 g/cm³`.

Se necesita ampliar la pista y el panel «Presiones MDT» con vistas de **Exceso de presión** y **Densidad equivalente de lodo (EMW)**, además de un resumen zonal de EMW y detección de densidades aparentes no físicas, sin alterar los gradientes ni contactos ya interpretados y conservando paridad exacta con la exportación de figuras PNG/SVG/PDF.

## Decisión

### 1. Definición exacta de Exceso de presión ($P_{\mathrm{ex}}$)

Para una profundidad $z$ (en metros) y una presión de formación $P(z)$ en una unidad de presión dada (internamente `psi`), dada una referencia hidrostática $(\rho_{\mathrm{ref}}, z_0, P_0)$ con $\rho_{\mathrm{ref}} \ge 0$ (en `g/cm³`), $z_0$ (en `m`) y $P_0$ (en la misma unidad de presión que $P$):

$$P_{\mathrm{ex}}(z) = P(z) - \bigl[P_0 + \rho_{\mathrm{ref}}\,g\,(z - z_0)\bigr]$$

donde $g = 9{,}80665\ \mathrm{m/s^2}$ (`G_STANDARD`, CGPM 1901) y el gradiente de referencia en la unidad de presión elegida se obtiene exactamente desde $g_{\mathrm{ref}}\,[\mathrm{kPa/m}] = \rho_{\mathrm{ref}}\,[\mathrm{g/cm^3}]\cdot g$ mediante los coeficientes de conversión de `src/core/units.ts` (en `psi/m`: $g / 6{,}894757293168361 \approx 1{,}42233433\ \mathrm{psi/m}$ por `g/cm³`).

- **Densidad de referencia $\rho_{\mathrm{ref}}$:** por defecto `1,00 g/cm³`, editable en `g/cm³` con presets de agua dulce (`1,00 g/cm³`), salmuera (`1,07 g/cm³`) y seguimiento opcional de la densidad del gradiente de agua activo (`excessRhoSource: 'water'`, cuando existe un gradiente visible de fluido `'water'` ajustado con densidad finita positiva).
- **Profundidad y presión de referencia $(z_0, P_0)$:** por defecto $z_0$ es el tope (menor profundidad) de las pruebas MDT incluidas y $P_0$ se ancla a la presión de esa primera prueba incluida (`excessAnchor: 'first'`), centrando el origen en `P_ex(z_0) = 0`. Al editar $z_0$ manualmente en el panel, la interfaz pasa automáticamente `excessAnchor` a `'zero'` ($P_0 = 0$) para evitar ubicar $P(z_1)$ en una cota distinta; si una configuración persistida combina `excessAnchor: 'first'` con un `excessZ0` explícito, `resolveExcessRef` proyecta $P_0 = P_1 + \rho_{\mathrm{ref}}\,g\,(z_0 - z_1)$ sobre la misma columna para garantizar $P_{\mathrm{ex}}(z_1) = 0$. El usuario también puede elegir directamente `P_0 = 0` (`excessAnchor: 'zero'`) o el preset de superficie (`z_0 = 0 m`, `P_0 = 0`) para leer la sobrepresión absoluta respecto de una columna hidrostática desde superficie ($P(z) - \rho_{\mathrm{ref}}\,g\,z$).
- **Proyección exacta de rectas lineales (`projectLinearTrendToExcess`):** para una tendencia lineal $P(z) = a + b\,z$, su proyección analítica al espacio de exceso es la recta exacta:

$$P_{\mathrm{ex}}(z) = (a - P_0 + g_{\mathrm{ref}}\,z_0) + (b - g_{\mathrm{ref}})\,z$$

  con pendiente $b_{\mathrm{ex}} = b - g_{\mathrm{ref}} = (\rho_{\mathrm{fluido}} - \rho_{\mathrm{ref}})\,g$. En consecuencia:
  1. Un acuífero con $\rho_{\mathrm{fluido}} = \rho_{\mathrm{ref}}$ tiene pendiente exactamente nula ($b_{\mathrm{ex}} = 0$) y se dibuja vertical.
  2. Para dos rectas cualesquiera $c_1, c_2$ con $b_1 \neq b_2$, la profundidad de intersección en $P_{\mathrm{ex}}$ es algebraicamente idéntica a la intersección en $P$: $z^*_{\mathrm{ex}} = (a_{2,\mathrm{ex}} - a_{1,\mathrm{ex}}) / (b_{1,\mathrm{ex}} - b_{2,\mathrm{ex}}) = (a_2 - a_1)/(b_1 - b_2) = z^*$.

### 2. Definición exacta de Densidad Equivalente de Lodo (EMW)

La densidad equivalente (EMW) referida explícitamente al datum de superficie $z = 0$ se define para $z > 0$ y $P \ge 0$ como:

$$\rho_{\mathrm{eq}}(z) = \frac{P(z)}{g \cdot z}$$

- En `g/cm³`: $\rho_{\mathrm{eq}}\,[\mathrm{g/cm^3}] = P\,[\mathrm{kPa}] / (9{,}80665 \cdot z\,[\mathrm{m}])$.
- En `lb/gal` (unidad por defecto en modo EMW): se registra la unidad `'lb/gal'` en `src/core/units.ts` (dimensión `'density'`, alias `PPG`, `LB/GAL`, `LBM/GAL`) con el factor SI exacto $1\ \mathrm{lb/gal} = 453{,}59237 / (231 \cdot 2{,}54^3) \approx 0{,}1198264273\ \mathrm{g/cm^3}$ ($1\ \mathrm{g/cm^3} \approx 8{,}345404452\ \mathrm{lb/gal}$). Esto equivale exactamente a $\rho_{\mathrm{eq}}\,[\mathrm{lb/gal}] = P\,[\mathrm{psi}] / ((12/231)\cdot z\,[\mathrm{ft}])$, donde $12/231 \approx 0{,}05194805\ \mathrm{psi/(ft\cdot lb/gal)}$ es el valor exacto de la aproximación habitual de campo `0,052` (diferencia relativa de `0,10 %`).
- Para $z \le 0$, $P < 0$ o entradas no finitas, la función devuelve `NaN`.
- Las tendencias lineales de presión $P(z) = a + b\,z$ se proyectan puntualmente en la pista como la curva $\rho_{\mathrm{eq}}(z) = (a + b\,z)/(g\cdot z)$ mediante el muestreo adaptativo de `sampleTrendPath`, conservando el punto de cruce exacto en cada contacto.

### 3. Preservación de ajustes y contratos en presión absoluta

- `mdtSeries`, `TrendSpec`, `evaluateTrend`, `mdtAnalysis` y `findContacts` operan **siempre** sobre la serie de presión absoluta (`psi` vs. `m`). Alternar el modo del eje X nunca reajusta regresiones, nunca modifica `Interpretation.trends` ni altera gradientes, densidades de fluido o profundidades de contacto.
- Para proyectar las líneas de tendencia y sus manijas sobre la pista MDT sin acoplar `src/plots/trend/` a `src/modules/mdt/`, se extiende `ResolvedSeries` con un método opcional `displayTransform(data, track)` y `TrendMapping.y(v, x?)` recibe la abscisa `x` (profundidad) como segundo argumento opcional. Si `displayTransform` está ausente o devuelve `null`, el comportamiento permanece idéntico al previo (`inSeriesUnit`).

### 4. Diagnóstico zonal de EMW y compartimentalización

En el módulo puro (`src/petro/pressure.ts` y `src/modules/mdt/model.ts`) se calcula por zona (zonas interpretadas con al menos una prueba incluida; si el pozo no tiene zonas interpretadas, agrupación por columna `zone` de origen si existe, o conjunto completo):
- `n` pruebas incluidas, rango de profundidad, **EMW medio** (y mínimo/máximo) en `g/cm³` y `lb/gal`;
- regresión lineal de $P(z)$ sobre las pruebas incluidas de la zona (`apparentDensity` en `g/cm³`, gradiente en `psi/ft` y $R^2$, para $n \ge 2$);
- salto máximo entre pruebas consecutivas en exceso de presión ($\Delta P_{\mathrm{ex}}$ respecto de la $\rho_{\mathrm{ref}}$ activa, o `1,00 g/cm³` si no está en modo exceso);
- señalización de **densidad aparente no física** cuando $\rho_{\mathrm{ap}} > 1{,}25\ \mathrm{g/cm^3}$ (`APPARENT_DENSITY_COMPARTMENT_LIMIT`, por encima del rango físico de salmueras saturadas `[0,98; 1,20] g/cm³`) sugiriendo compartimentalización / sobrepresión escalonada, o cuando $\rho_{\mathrm{ap}} \le 0\ \mathrm{g/cm^3}$ (gradiente invertido / posible depleción).

### 5. Persistencia visual y paridad con exportación de figuras

El modo visual y sus parámetros se guardan como claves primitivas opcionales en `project.display.overlays.mdt` (mismo contrato JSON puro que `unit` y `pointColor` en PR #107, sin cambiar la versión del formato de proyecto ni invalidar el motor petrofísico):
- `axisMode`: `'excess' | 'emw'` (omitido para `'pressure'`);
- `excessRhoRef`: número en `g/cm³` (omitido para `1,00`);
- `excessRhoSource`: `'water'` (omitido cuando es manual);
- `excessZ0`: número en `m` (omitido cuando toma el tope automático de las pruebas incluidas);
- `excessAnchor`: `'zero'` (omitido cuando ancla a la 1.ª prueba incluida `'first'`);
- `emwUnit`: `'g/cm3'` (omitido para `'lb/gal'`).

Se agrega `interpretation?: Readonly<Interpretation>` opcional a `OverlayTrackContext` y `OverlayTracksContext` y se pasa tanto desde `ViewerSlot.tsx` como desde `src/app/export/figureSources.ts`. Así, la pista interactiva, la lupa y las figuras exportadas en PNG, SVG y PDF comparten exactamente la misma resolución de escala, unidad, título (`Presión`, `Exceso P (ρ_ref)` o `EMW (z = 0)`), puntos, rectas proyectadas y contactos.

### 6. Advertencias explícitas sobre MD/TVD y datum

Tanto en el panel MDT (callout visible en modo `Exceso` y `EMW`) como en el título de la pista EMW (`EMW (z = 0)`) y la documentación del módulo Ecuaciones:
- Si el conjunto no trae columna `tvd`, se advierte explícitamente que $z$ es profundidad medida (MD) sin corrección a TVD y que en `EMW` (o en `Exceso` con `z_0 = 0`) el datum de superficie $z = 0$ no está verificado.
- Si existe columna `tvd` con desvío $|MD - TVD| > 1\ \mathrm{m}$, se advierte que los gradientes, el exceso de presión y la EMW calculados sobre MD subestiman las densidades reales.

## Alternativas descartadas

1. **Ajustar las tendencias directamente sobre una serie transformada $P_{\mathrm{ex}}(z)$ o $\rho_{\mathrm{eq}}(z)$:** introduciría acoplamiento entre la visualización y el modelo guardado, requeriría invalidar o reconvertir `TrendSpec.manual` al cambiar $\rho_{\mathrm{ref}}$ y en modo EMW un ajuste lineal en $\rho_{\mathrm{eq}}(z)$ no representa una columna hidrostática de densidad constante.
2. **Guardar el modo de eje X en `Interpretation`:** cambiar la visualización de la pista MDT dispararía recálculos o ensuciaría snapshots petrofísicos; el modo del eje es una preferencia de presentación como `unit` y `pointColor` en `project.display.overlays.mdt`.
3. **Usar el factor aproximado de campo `0,052 psi/(ft·lb/gal)` en lugar de la conversión SI exacta:** introduciría una discrepancia interna de `0,10 %` entre `EMW` en `lb/gal` y `EMW` en `g/cm³` dentro de la misma aplicación (donde `G_STANDARD = 9,80665` y `1 psi = 6,894757293168361 kPa` rigen todo el motor).

## Límites científicos y qué no cubre

- El cálculo actual usa profundidad medida MD (con el desplazamiento del conjunto si existiera) y no transforma automáticamente a TVD/TVDSS aunque el conjunto traiga columna `tvd`; en pozos desviados o con mesa rotaria elevada respecto del nivel del terreno/mar, la EMW real requiere corregir por TVD y cota de datum.
- El umbral `1,25 g/cm³` es un criterio diagnóstico de columna continua de agua/salmuera; un valor menor no descarta por sí solo sellos con saltos pequeños (por eso se acompaña con la vista de exceso de presión y el salto consecutivo máximo $\Delta P_{\mathrm{ex}}$), y un valor mayor no distingue automáticamente entre compartimentalización geológica y sobrecarga (*supercharging*) por invasión de filtrado.
- No se implementa aquí la partición automática de compartimentos ni la estimación de presión de fractura / sobrecarga litostática.
