# 0017 — Calculadora de agua de formación e indicadores automáticos

- Estado: aceptada (fase 7c, funciones Y y D).
- Alcance: funciones puras `src/petro/brine.ts` (salinidad ↔ Rw ↔ temperatura) y `src/petro/indicators.ts` (banderas),
  inversa de Arps en `src/petro/temperature.ts`; pestaña del dock `src/modules/formation-water/` (`dock.tsx`,
  `model.ts`, `docs.ts`, `formation-water.css`); cuatro módulos de cálculo `src/modules/ind-*/`; pista «Indicadores»
  (`src/viewer/templates.ts`, `src/viewer/catalog.ts`); paleta de las franjas (`src/ui/curves.ts`); el control de calidad
  de derrumbe (`src/io/qc.ts`) pasa a usar la misma función.
- Parte de: 0003 (control de calidad), 0005 y 0016 (visor y pistas), 0007 (módulos de agua y cutoffs, parámetros
  compartidos) y 0015 (escritura de parámetros desde otro panel, `commitPlotParams`).

## Y. Calculadora de agua de formación

### Y1. Correlación: Bateman y Konen (1977) para la salinidad, Arps para la temperatura

`Rw75 = 0,0123 + 3647,5 / C^0,955` (C en ppm de NaCl, Rw a 75 °F en ohm·m) y su inversa
`C = (3647,5 / (Rw75 − 0,0123))^(1/0,955)`; la temperatura con la corrección de Arps que ya existía
(`arpsResistivityC`, constante 6,77 °F) y su inversa nueva (`arpsTemperatureC`) para despejar la temperatura. La
Bateman–Konen es un ajuste de la carta Gen-9 de Schlumberger (que a su vez se apoya en los datos de Arps 1953), así
que la calculadora es consistente con la corrección de `rw-manual` y `temp-gradient`.

- **Rango**: 1 000–250 000 ppm. Contra conductividades medidas de NaCl a 25 °C (CRC; Robinson y Stokes) el error es
  ≲ 5 % entre 1 000 y 150 000 ppm (−3,8 % a 585 ppm, −2,3 % a 5 800, −1,1 % a 56 000), ≈ 8 % a 100 ppm (conductividad
  límite de Onsager); por encima de 150 000 ppm el error no está verificado contra datos (revisión de 7c). Temperatura: la carta llega a ≈ 200 °C; por encima es extrapolación (el mismo aviso que el Pickett de 7b).
- **Avisos** (`waterWarnings`, bordes inclusivos): salinidad < 1 000 o > 250 000 ppm; entre 150 000 y 250 000 ppm
  («la correlación se aparta de la carta»); temperatura > 200 °C o < 0 °C.
- **NaCl equivalente**: la salinidad que sale de una Rw medida es la de NaCl equivalente. Una salmuera con calcio,
  magnesio o sulfatos necesita los multiplicadores iónicos de la carta Gen-8: no están implementados (pendiente).
- Descartado: **Crain (1974) o Kennedy (2015)** como correlación principal. Dan prácticamente lo mismo a salinidades
  normales y divergen apenas por encima de 150 000 ppm; la de Bateman–Konen es un ajuste directo de la carta Gen-9
  y una expresión cerrada, invertible sin iterar.
- Descartado: **tabla interpolada de la carta Gen-9**. Habría que transcribir valores de una carta impresa sin poder
  verificarlos en el entorno de trabajo.

### Y2. Rmf desde Rm: pendiente

Overton y Lipson (1958) dan `Rmf = Km · Rm^1,07` con `Km` según el peso del lodo; la tabla de `Km` no se pudo
verificar contra la carta (y la regla estadística `Rmf ≈ 0,75·Rm` tampoco). Para no cargar un valor dudoso se dejó
pendiente: el que quiera Rmf puede ingresarla a mano en el SP (`rw-sp`). La calculadora sirve también para llevar una
Rmf medida a otra temperatura (es una solución de NaCl como cualquier otra).

### Y3. Interfaz: tres valores, uno calculado

Un selector «Calcular: Rw · Salinidad · Temperatura» decide cuál de los tres es el resultado (en un recuadro con la
insignia «calculada»); los otros dos se escriben. Es la lectura más simple de «completar dos calcula el tercero» y
evita estados ambiguos (tres campos llenos que no concuerdan).

- **La temperatura** sale del perfil del pozo a una profundidad elegida (por defecto la mitad del pozo) o se escribe a
  mano. Del pozo: la curva TEMP calculada que alimenta la cadena (`temp-gradient`), si no la medida, si no el
  gradiente de los parámetros del proyecto (la misma cuenta del módulo). La fuente se rotula en el panel.
- **Rw a lo largo del pozo**: tabla con la temperatura y la Rw en el tope de cada zona (misma agua, Arps) y un
  minigráfico Rw–profundidad con los topes. Las temperaturas > 200 °C se resaltan.
- **«Usar como Rw manual»** escribe `rw-manual.rwRef` y `rw-manual.tRef` (claves de `PLOT_PARAMS`, globales) con
  `commitPlotParams`: una sola entrada de deshacer, «Usar como Rw manual». Rw se redondea a 4 decimales y T a 0,1 °C.
  Si la temperatura queda fuera del control de `rw-manual` (0–200 °C; el pozo de demostración llega a 262 °C con el
  gradiente por defecto), **se guarda la misma agua expresada a 75 °F** (23,9 °C): `rw-manual` la lleva de vuelta a
  cada profundidad con la misma ley de Arps, así que el resultado es idéntico, y el panel lo avisa. Si la Rw no entra
  en 0,005–5 ohm·m, el botón se desactiva y explica por qué (no se recorta en silencio). No toca `correct`
  («Corregir por temperatura») ni elige la fuente de RW: si `rw-manual` no alimenta la cadena, se ofrece «Usar Rw manual».
- La calculadora vive en el dock (`src/modules/formation-water/dock.tsx`, descubierta sola). Su estado (cuál se
  calcula, valores) es de interfaz y no se guarda; lo que se guarda es el Rw manual. La lógica sin interfaz está en
  `model.ts` (testeada); las ecuaciones solo en `docs.ts` para el módulo Ecuaciones, no en el panel.

## D. Indicadores automáticos

### D1. Cuatro módulos, una categoría «Indicadores», un rol de bandera cada uno

`ind-gas-crossover`, `ind-shale`, `ind-coal` e `ind-washout`: módulos de cálculo puros (salida `IND_GAS`,
`IND_SHALE`, `IND_COAL`, `IND_WASHOUT`: curvas 0/1/NaN de familia `flag`, roles declarados por cada módulo) en la
categoría nueva `indicators` («Indicadores», fuera de los pasos del flujo guiado: se llega desde «Todos los módulos»).
Cuatro módulos y no uno porque las entradas difieren y cada indicador debe correr con lo que haya (el carbón sin
sónico, el derrumbe sin Vsh). Los parámetros son sliders del esquema (por zona).

### D2. Reglas y umbrales por defecto

Los umbrales son criterios prácticos, **no valores de libro** (dependen de la litología, del ruido y del intérprete),
por eso son parámetros. Bordes: inclusivos (como `cutoffs`: el valor igual al umbral cuenta como presente), salvo el
derrumbe que hereda el criterio ESTRICTO del control de calidad.

| Indicador | Regla (1 = presente) | Por defecto | Base |
|---|---|---|---|
| Crossover de gas | `PHID − PHIN ≥ Δmín` y `Vsh ≤ Vsh máx` | Δmín = 0,03 v/v; Vsh máx = 0,4 (compartida con `cutoffs`) | Asquith y Krygowski (2004), cap. 5: el gas baja la lectura del neutrón y de la densidad; 0,03 = unos 3 puntos de porosidad sobre el ruido |
| Arcilla | `Vsh > Vsh máx` | 0,4 (compartida) | Complemento exacto del corte de reservorio de `cutoffs` (Asquith y Krygowski; Worthington y Cosentino 2005) |
| Carbón | `RHOB ≤ ρmáx` y (`DT ≥ Δtmín` o `NPHI ≥ φNmín`) | ρmáx = 2,0 g/cm³; Δtmín = 100 µs/ft; φNmín = 0,40 v/v | Rider y Kennedy (2011): carbón 1,2–1,8 g/cm³, Δt ≈ 105–140 µs/ft, neutrón alto; 2,0 deja margen |
| Derrumbe | `CALI − BS > tol` (estricto), CALI ≥ 5 in | tol = 1 in; trépano nominal 8,5 in si no hay BS | `io/qc.ts` (`QC_DEFAULTS`) |

- **Sin dato** (NaN): falta una curva necesaria y no se puede decidir. **Descarte seguro** → 0: si una curva conocida ya
  excluye la muestra (Vsh > máx en el gas; RHOB > ρmáx en el carbón) la bandera es 0 aunque falte otra, como en `cutoffs`.
  En el carbón, una confirmación alcanza aunque falte la otra; si ninguna confirma y falta alguna → NaN. En el derrumbe,
  un caliper inválido (< 5 in) o faltante → NaN (el control de calidad lo informa aparte).
- **Vsh máxima compartida** (`SHARED_PARAMS.vshCutoff`): un solo control para «qué es arcilloso» en los cutoffs, el gas
  y el indicador de arcilla. Mover el slider del indicador mueve el corte de reservorio (la decisión de 0007: un
  parámetro compartido tiene un solo control). Alternativa descartada: un Vsh propio por indicador (dos definiciones
  de «arcilloso» en el mismo pozo).
- **PHID y PHIN en la misma escala**: con los valores por defecto (matriz de arenisca 2,65 en la densidad y neutrón sin
  corrección) un neutrón en unidades de caliza lee ≈ 0,04 de menos en arenisca limpia y el cruce se infla. El tooltip lo
  avisa; la corrección está en el paso Porosidad (`phi-neutron.matrixOffset`). En el pozo del TP: 16 muestras con gas sin
  corrección y 3 con +0,04.
- **Un solo criterio de derrumbe**: `isWashout` (en `petro/indicators.ts`) lo usan el indicador y `runQc`
  (`src/io/qc.ts`); en el pozo del TP el indicador marca las mismas 71 muestras que el informe de calidad y deja 189
  sin dato (caliper 1,098 in), tal como dice `datos/README.md`.

### D3. Visor: pista «Indicadores»

Se reutiliza el tipo de pista `flags` (franjas de color con leyenda, columnas de ancho fijo): pista de fábrica
`indicators` en Petrofísica, después de «Banderas», con las cuatro curvas por rol (así el recolector de «Banderas» no
las duplica), oculta mientras no haya ninguna. En el catálogo, herramienta «Indicadores» en el grupo Banderas. Colores
curados (`CURVE_PALETTE`, tipo `band`): gas ámbar, arcilla marrón, carbón negro (gris claro en el tema oscuro) y
derrumbe azul pizarra, distintos de reservorio (amarillo) y pay (rojo). La leyenda va de la franja de arriba hacia abajo
en orden inverso al de dibujo, como en las demás pistas.

## Pendiente

- Rmf desde Rm (Overton y Lipson, tabla de Km) y multiplicadores iónicos de la carta Gen-8.
- Cutoffs por zona del gas/carbón desde un gráfico (hoy son sliders del inspector).
- Persistir los valores de la calculadora en el proyecto, si el flujo lo pide.
