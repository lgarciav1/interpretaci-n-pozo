# 0090 — Rayos gamma sin uranio (`CGR`) conectado a `IGR` / `Vsh`

Fecha: 2026-11-25. Sigue a la 0007 (catálogo de módulos de arcillosidad), la 0046 (calibración de extremos de GR) y a Geo-2 (`clay-typing`, Th–K y alertas de U).

## Contexto

El CSV del TP trae `GR` total junto con `THOR` (ppm), `POTA` (%) y `URAN` (ppm), pero no una curva `CGR` (GR sin uranio). El uranio no está ligado a las arcillas: se concentra en materia orgánica, fracturas y precipitados diagenéticos, y un `IGR` calculado desde `GR` total sobreestima `Vsh` donde hay uranio. Hace falta (1) una curva `CGR` reproducible, (2) poder elegir si `IGR` sale de `GR` o de `CGR` y comparar ambos, y (3) no alterar ni un decimal del recorrido de réplica del TP, que usa `igr` (GR total) como fuente por defecto de `IGR`.

## Decisión

### 1. Dos módulos separados: `cgr` + `igr-cgr`

- `cgr` (categoría `shale`): produce `CGR` (gAPI equivalente sin uranio), `U_GR_FRAC` (fracción del GR modelado atribuible al uranio, `0–1`) y la tabla de diagnóstico `CGR_CALIBRATION`.
- `igr-cgr` (categoría `shale`): produce el puerto `IGR` desde `CGR` con parámetros **propios** por zona `cgrClean` y `cgrShale` (no comparte `grClean`/`grShale`: la escala de `CGR` es menor que la de `GR` total y compartirlos falsearía uno de los dos).
- Ambos se registran en `MODULES` **después** de `igr`. El planificador elige la primera candidata ejecutable por puerto (curvas medidas primero, luego módulos en orden de registro), así que `igr` sigue siendo la fuente por defecto de `IGR` y el TP no cambia. Si un pozo trae `CGR` medido, la curva medida gana sobre el módulo `cgr` por la misma regla.
- El usuario cambia la fuente de `IGR` a `igr-cgr` en el paso Arcilla, o compara ambas con `compare` / Snapshots + Cortina, y ve el impacto en `VSH`, `PHIE` y `NET_PAY` sin tocar `igr`.

Alternativa descartada: un parámetro «fuente GR / CGR» dentro de `igr`. Mezclaría dos juegos de extremos en un mismo módulo, haría que el parámetro compartido `grClean` signifique cosas distintas según el modo y rompería la comparación lado a lado que da el grafo de fuentes.

### 2. Coeficientes: ajuste empírico en el pozo antes que constantes de herramienta

Para una herramienta de fabricante y calibración desconocidos, las constantes de conversión ppm/% → gAPI no son universales. Modos del parámetro `mode` de `cgr`:

- **`auto` (por defecto):** usa `fit` si están las cuatro curvas `GR`, `THOR`, `POTA`, `URAN`; si no, `standard`.
- **`fit` — Ajustado en el pozo:** mínimos cuadrados ordinarios **sin intercepto** `GR ≈ a·Th + b·K + c·U` sobre las muestras válidas de todo el pozo. Se informan `a, b, c`, `R²` (centrado, `1 − SSE/Σ(GR − ḠR)²`, más exigente que el no centrado) y `RMSE` en `CGR_CALIBRATION`, más `R²`/`RMSE` por zona con los coeficientes globales para detectar zonas donde la relación cambia.
- **`standard` — Coeficientes estándar orientativos:** `GR ≈ 4·Th + 16·K + 8·U` (relación aproximada de herramientas NGS, Ellis y Singer 2007), con aviso explícito de que dependen del fabricante y la calibración.

`CGR` se define por el parámetro `formula`:
- `thk` (por defecto): `CGR = a·Th + b·K`.
- `residual`: `CGR = max(0, GR − c·U)` (requiere `GR` y `URAN`; conserva el ruido y los efectos ambientales del GR medido).

`U_GR_FRAC = c·U / (a·Th + b·K + c·U)` recortado a `[0, 1]`; sin dato si el denominador no es positivo.

### 3. Guardas de dominio

- Muestra válida para el ajuste: las cuatro curvas finitas, `GR ≥ 0`, `Th ≥ 0`, `K ≥ 0`; `U` finito (se admiten valores levemente negativos: son ruido estadístico de conteo alrededor de cero y descartarlos sesga `c`).
- Ajuste no identificable (menos de 30 muestras válidas o sistema normal singular / mal condicionado): se avisa y se cae a `standard`.
- Algún coeficiente `≤ 0`: incoherente físicamente; se avisa y se cae a `standard` (nunca se usa un coeficiente negativo).
- `R² < 0,85`: se avisa incoherencia (curvas desfasadas en profundidad, corrección ambiental distinta entre GR y espectral, herramienta mal calibrada), pero se usan los coeficientes ajustados.
- Al calcular `CGR`: `Th` o `K` no finitos → sin dato; los negativos se recortan a `0` antes de multiplicar; `CGR ≥ 0` siempre. Las curvas originales nunca se modifican.

## Límites científicos

- El ajuste es empírico y global: absorbe diferencias de calibración y ambientales entre el GR total y el espectral, pero no corrige un desfase en profundidad entre corridas.
- `CGR` no es una medida de `Vsh`: el potasio y el torio también aparecen en feldespatos, micas y minerales pesados; `IGR` desde `CGR` sigue requiriendo extremos limpio/arcilla elegidos por zona.
- `U_GR_FRAC` es una fracción del GR **modelado**, no del medido.

## Alternativas descartadas

- Constantes fijas siempre (`4/16/8`): ocultan la calibración real del pozo; quedan como modo explícito orientativo.
- Ajuste con intercepto: un intercepto absorbe fondo instrumental pero quita el significado físico de `CGR = 0` para roca sin Th ni K; se prefiere sin intercepto y reportar `R²`/`RMSE`.
- Ajuste por zona: con pocas muestras por zona los coeficientes se vuelven inestables y colineales (Th y K covarían en las arcillas); se ajusta en todo el pozo y se diagnostica por zona.

## Referencias

- Ellis, D. V. y Singer, J. M. (2007). *Well Logging for Earth Scientists*, 2.ª ed. Springer, cap. 7 (espectroscopía de rayos gamma naturales).
- Schlumberger (1989). *Log Interpretation Principles/Applications*, cap. 4 (NGS, `SGR` y `CGR`).
- Draper, N. R. y Smith, H. (1998). *Applied Regression Analysis*, 3.ª ed. Wiley (regresión por el origen y `R²`).
