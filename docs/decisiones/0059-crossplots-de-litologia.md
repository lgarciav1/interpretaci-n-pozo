# 0059 — Crossplots de determinación de litologías (Clase 8)

- Estado: implementada.
- Alcance: seis plantillas nuevas del crossplot libre (`sonic-neutron`, `density-sonic`, `m-n`, `rhomaa-umaa`, `pe-k`,
  `pe-thk`), motor puro `src/petro/lithologyIndices.ts`, módulo `lithology-indices` y menú de plantillas agrupado.
- No cambia: densidad–neutrón, Pickett, φ–Sw, GR–Rt, RMN vs. densidad–neutrón, torio–potasio ni PE–densidad.

## Contexto

La Clase 8 de la cátedra (slides 17–33) enumera los crossplots de determinación de litologías: densidad–neutrón,
sónico–neutrón, densidad–sónico, densidad–PEF, M–N, identificación de matriz (ρmaa–Umaa) y GR espectral (PEF contra K y
contra Th/K). La app tenía densidad–neutrón, PE–densidad y torio–potasio. Faltaban seis.

## D1. Patrón

Igual que `th-k` y `pe-density` (0026): id en `CROSSPLOT_TEMPLATES` (`src/core/plots.ts`, la lista que sanea los
proyectos guardados), definición en `CROSSPLOT_TEMPLATE_DEFS` con ejes por rol, y capas puras en
`lithologyTemplateLayers` (`src/plots/crossplot/templates.ts`) con los datos de `src/petro/lithologyIndices.ts`. El panel
solo les pasa los colores del tema (rellenos de arenisca, caliza, dolomía, anhidrita y sal, con contraste 3:1 contra
la pista). Aparecen en el menú «Plantilla» y en la paleta de comandos (`crossplot:template:<id>`) sin código extra.

Agregados aditivos a la definición: `group` (el menú se divide en «Litología y mineralogía» y «Porosidad y fluidos»),
`zoneColor` (reemplaza la lista fija `th-k`/`pe-density` que coloreaba por zona) y `needs` (de qué módulo salen las
curvas derivadas, para el motivo). El menú muestra el motivo corto de toda plantilla que no se puede armar
(«falta POTA», «THK sin datos»); al elegirla, el aviso de siempre lo explica. Una curva derivada que existe pero quedó
toda sin dato (el módulo corrió sin una de sus entradas) también deshabilita la plantilla.

## D2. Curvas derivadas: módulo `lithology-indices`

M, N, Umaa y Th/K no existían. Un módulo puro (categoría y espacio Geología, como `clay-typing` y `mineral-inversion`)
las calcula por muestra con roles nuevos declarados por el módulo: `M`, `N`, `UMAA` y `THK` (unidad `unitless`; Umaa se
rotula en b/cm³ porque el catálogo de unidades no tiene barn/cm³ y agregarla tocaba el núcleo). Colores curados en
`CURVE_PALETTE`. ρmaa no se duplica: sigue saliendo de `core-calibration` (RHOMAA).

Todas las entradas son opcionales (RHOB, NPHI, DT, PEF, PHIT, THOR, POTA) con un grupo «densidad o potasio»: cada
curva que no tiene sus entradas queda sin dato y el módulo avisa cuál falta, sin bloquear las demás. Parámetros por
zona con tooltip: Δt del fluido (189 µs/ft), densidad del fluido (1,0), neutrón del fluido (1,0) y U del fluido
(0,398 b/cm³).

Fórmulas (en `docs` del módulo, no en la interfaz):

- M = 0,01·(Δtf − Δt)/(ρb − ρf); N = (φNf − φN)/(ρb − ρf). Burke, Campbell y Schmidt (1969).
- U = Pe·ρe con ρe = (ρb + 0,1883)/1,0704 (la misma `electronDensity` de la inversión mineral).
- Umaa = (U − φt·Uf)/(1 − φt) con φt la porosidad total de densidad–neutrón (PHIT).
- Th/K = Th (ppm) / K (%).

Dominio: NaN si una entrada no es finita, si ρb ≤ ρf (M y N), Pe ≤ 0 o ρb ≤ 0 (U), φt < 0 o φt ≥ 1 (Umaa, ρmaa),
K ≤ 0 o Th < 0 (Th/K). Nunca una excepción.

Chequeo de cordura (tests, calculado a mano fuera del código): cuarzo (2,64; Pe 1,8) da U = 4,756 ≈ 4,8 y calcita
(2,71; 5,1) da 13,809 ≈ 13,8, como el Appendix B. Dolomita (2,85; 3,1) da 8,80 contra U tabulado 9,0: el Appendix B
redondea el Pe (3,14 daría 8,91).

## D3. Constantes y fuentes

| Plantilla | Fuente de las líneas guía |
|---|---|
| Sónico–neutrón, densidad–sónico | Wyllie Δt = Δtma + φ·(Δtf − Δtma) y mezcla lineal de neutrón y densidad, φ de 0 a 0,45, marcas cada 0,1. Matrices del Appendix B (slides 20–21): cuarzo 2,64 g/cm³ · 56,0 µs/ft · φCNL −0,02; calcita 2,71 · 49,0 · 0; dolomita 2,85 · 44,0 · +0,01; anhidrita 2,98 · 50 · −0,02; sal 2,04 · 67 · −0,03; yeso 2,35 · 52 · 0,60. |
| M–N | Puntos de las mismas matrices con agua dulce y el triángulo cuarzo–calcita–dolomita. |
| ρmaa–Umaa | Triángulo cuarzo (4,8; 2,65), calcita (13,8; 2,71), dolomita (9,0; 2,87) y grilla cada 20 %, de la carta de la slide 27 y de la hoja CROSSPLOT del Excel (columnas D:I; test ±0,006 g/cm³). Feldespato K (7,6; 2,62), caolinita (6,25; 3,025), illita (11,7; 3,065) y anhidrita (14,95; 2,985) leídos de la carta. Flechas de sal, gas, baritina y minerales pesados, posiciones leídas. |
| PEF–Th/K | Cajas de Lith-1 (ex CP-18) iguales vértice a vértice a los polígonos de la hoja CROSSPLOT (columnas X:Z; test exacto). |
| PEF–K | Bandas de PEF de la misma hoja; rangos de K leídos de la carta de la slide 28. Sin capas mixtas (la carta no la trae contra K). |

La densidad, el Pe y el φCNL salen de `MINERALS` (`src/petro/mineralogy.ts`, mismas filas del Appendix B); Δt y U
tabulados se agregan en `lithologyIndices.ts`. No se tocó ninguna constante existente.

Diferencias con lo que ya existía (documentadas, no corregidas):

- `DN_LITHOLOGIES` (densidad–neutrón) usa cuarzo 2,65 y dolomita 2,87; el Appendix B dice 2,64 y 2,85. Las rectas de
  sónico usan el Appendix B (pedido de la cátedra); el triángulo ρmaa–Umaa usa 2,65 y 2,87 porque así está la carta de
  la slide 27 y el Excel de la cátedra.
- `sharedParams.dtMa` sugiere Δtma 55,5 / 47,5 / 43,5 µs/ft (arenisca, caliza, dolomía); el Appendix B trae 56,0 /
  49,0 / 44,0. Las líneas guía usan el Appendix B; el parámetro de la porosidad sónica no cambia.
- La inversión mineral usa PE del agua 0,36 b/e (U ≈ 0,40); Umaa usa Uf = 0,398 b/cm³. Equivalentes a 0,002.
- El neutrón de las rectas es la mezcla φN = φNma·(1 − φ) + φ (la de densidad–neutrón), no φ + φNma: la diferencia
  es φNma·φ, menos de 0,01 en todo el rango.

## D4. Rangos, escalas y color

- Sónico–neutrón: NPHI −0,05–0,45 · DT 40–140 µs/ft. Densidad–sónico: DT 40–140 · RHOB 1,9–3,0 invertida. Color por GR.
- M–N: N 0,25–0,8 · M 0,4–1,1 (el yeso, N ≈ 0,30, entra; la sal, N ≈ 0,99 y M ≈ 1,17, queda afuera y lo dice el
  texto). Color por GR.
- ρmaa–Umaa: el rango de la carta, Umaa 2–17 · ρmaa 2,2–3,1 invertida. Color por GR. Botones «Ver toda la nube» y
  «Rango de la carta» (como «Ver todos los minerales» de PE–densidad). Si más del 5 % de las muestras cae a la derecha
  de la carta, el texto de ayuda lo cuantifica y nombra la baritina.
- PEF–K: K 0–10 % · PEF 0–10, lineal. PEF–Th/K: Th/K 0,1–100 log · PEF 0–10. Color por zona.

## D5. Con el pozo del TP

Probado en el HTML construido con «Cargar datos del TP» (el pozo sintético de demostración no tiene THOR ni POTA: allí
PEF–K, PEF–Th/K y torio–potasio quedan deshabilitadas con el motivo, `docs/capturas/crossplots-litologia/menu-sin-curvas-claro.png`).

- Sónico–neutrón y densidad–sónico: las arenas (GR bajo) caen entre las rectas de arenisca y caliza con 15–25 % de
  porosidad; las arcillas se van a Δt y neutrón altos, como en las slides 22–25.
- M–N: la nube limpia rodea los puntos de cuarzo y calcita; las arcillas bajan hacia M ≈ 0,6 y N ≈ 0,5.
- ρmaa–Umaa: ρmaa 2,65–2,80 (bien), pero el 76 % de las muestras tiene Umaa > 17 (dato que muestra el panel): a la derecha de la
  calcita, sobre la flecha de la baritina. Es el PEF alto del lodo (`datos/README.md`, 0029), no la matriz.
- PEF–K y PEF–Th/K: K 1,2–3,1 % y Th/K 4–9 (zona de capas mixtas / illita), pero con PEF 5–10, por encima de todas
  las cajas por la misma baritina.

## Límites

- Cajas de Lith-1 y puntos/flechas de la carta ρmaa–Umaa: orientativos, SIN VERIFICAR contra la carta original del
  fabricante. Los rótulos y el texto de ayuda lo dicen.
- Wyllie sin compactación ni curva empírica (Raymer–Hunt): sobre ~25 % de porosidad las cartas CP-2/CP-7 se curvan.
- M, N y Umaa suponen el fluido de la zona lavada: gas, arcilla y porosidad secundaria corren los puntos.
- Umaa con lodo con baritina no es interpretable; no se intenta corregir.
- Capturas: `docs/capturas/crossplots-litologia/` (claro y oscuro).
