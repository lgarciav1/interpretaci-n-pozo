# 0061 — Distribución de la arcilla: diagrama de Thomas–Stieber

- Estado: implementada.
- Alcance: motor puro `src/petro/clayDistribution.ts`, módulo `clay-distribution`, plantilla `thomas-stieber` del
  crossplot libre con los extremos arrastrables, «Estimar de los datos» y resumen de la nube.
- No cambia: el contrato de módulo, el motor ni las plantillas existentes. Cambios chicos fuera del módulo: la lista
  `CROSSPLOT_TEMPLATES` (`src/core/plots.ts`, como en 0059), `PLOT_PARAMS` (`src/plots/params.ts`), la paleta de curvas
  (`CLAY_DIST`) y dos arreglos generales que salieron de la prueba en navegador (D6).

## Contexto

La Clase 8 de la cátedra (slides 12–14, «Mineralogía de arcillas») presenta las tres formas en que la arcilla se
distribuye en una arena —laminar, estructural y dispersa— y el diagrama porosidad contra Vsh con las regiones A y B.
Sirve para elegir el modelo de saturación (laminar → Poupon–Leveaux o Indonesia; dispersa → Waxman–Smits o Dual-Water,
Simandoux como aproximación) y para entender la permeabilidad (la dispersa es la que más la daña). La app no lo tenía.

## D1. Geometría (verificada contra la slide 14)

Ejes x = Vsh (v/v, 0–1) e y = porosidad total φ (v/v). Extremos: arena limpia (0, φsand) y lutita (1, φsh). Todas las
rectas son lineales en x:

| Recta | Ecuación | Tramo |
|---|---|---|
| Laminada (diagonal) | φ = (1 − x)·φsand + x·φsh | 0 ≤ x ≤ 1 |
| Dispersa, relleno de poros | φ = φsand − x·(1 − φsh) | 0 ≤ x ≤ φsand |
| Dispersa, reemplazo de granos | φ = x·φsh | φsand ≤ x ≤ 1 |
| Estructural, reemplazo de granos | φ = φsand + x·φsh | 0 ≤ x ≤ 1 − φsand |
| Estructural, relleno de poros | φ = 1 − x·(1 − φsh) | 1 − φsand ≤ x ≤ 1 |

Vértice inferior (φsand, φsand·φsh) y superior (1 − φsand, φsand + (1 − φsand)·φsh). Región A (debajo de la
diagonal) = mezclas con arcilla dispersa; región B (encima) = estructural.

Coincide con la slide 14: «Maximum porosity» a la izquierda, «Shale porosity» a la derecha, «Laminated» como diagonal,
«Dispersed Pore Filling» bajando hasta el vértice inferior y «Dispersed Grain Replacing» subiendo a la lutita, «Structural
Grain Replacing» subiendo hasta el vértice superior y «Structural Pore Filling» bajando a la lutita; A debajo y B encima.
La slide no trae números: la geometría (pendientes y vértices) es la del modelo de volúmenes de Thomas y Stieber (1975)
y los valores de control del brief (φsand 0,30, φsh 0,10: laminada en 0,5 → 0,20; dispersa en 0,1 → 0,21; vértices
(0,30; 0,03) y (0,70; 0,37); estructural-relleno en 0,85 → 0,235; reemplazo dispersa en 0,6 → 0,06) se verifican en
`tests/petro-thomas-stieber.test.ts`. No encontré diferencias.

Dominio: 0 < φsh < φsand < 1. Fuera de dominio las funciones devuelven NaN o null y la clasificación «sin clasificar»;
nunca una excepción.

## D2. Clasificación por muestra y banda laminar

`classifyClayDistribution(vsh, φ, φsand, φsh, τ)`:

- sin dato (Vsh o φ no finitos) o extremos inválidos → sin clasificar;
- Vsh < 0,1 (arena limpia) o Vsh > 0,9 (lutita: las cinco rectas convergen en un punto y la clasificación no tiene
  sentido) → sin clasificar; Vsh fuera de [0, 1] → fuera del diagrama;
- |φ − φlaminada| ≤ τ → laminar;
- debajo de la banda y como mucho τ por debajo del borde inferior → dispersa (A); encima y como mucho τ por encima del
  borde superior → estructural (B); más lejos → fuera del diagrama (sin clasificar).

τ («Banda laminar», parámetro por zona) vale 0,02 v/v por defecto: del orden del error de la porosidad de
densidad–neutrón. El mismo margen se aplica afuera de los bordes del diagrama para no dejar sin clasificar puntos que
caen apenas afuera por ruido. Los umbrales de Vsh 0,1 y 0,9 son constantes documentadas (los mismos que usa el
estimador), no parámetros.

Curva `CLAY_DIST` (rol nuevo del módulo, unitless, 0–3, raya-punto marrón en la paleta): 0 sin clasificar, 1 laminar,
2 dispersa, 3 estructural, NaN sin dato. Tabla `CLAY_DIST_ZONES` (en Resultados): % de laminares, dispersas, estructurales
y sin clasificar sobre las muestras con dato de cada zona, cantidad de muestras y la que predomina entre las clasificadas.

## D3. Estimador de los extremos

`estimateClayEndpoints(vsh, phit)`: φsand = percentil 95 (interpolación lineal, tipo 7) de PHIT con Vsh ≤ 0,1 —las
arenas más limpias y porosas, la porosidad «original»—; φsh = mediana de PHIT con Vsh ≥ 0,9. Mínimo 10 muestras por
extremo; si no alcanza, ese extremo es null y el motivo dice cuántas hay y cuántas hacen falta. Si φsh no queda por
debajo de φsand, también lo dice. En el gráfico usa los puntos visibles (respeta el filtro de zonas) y escribe en el
alcance del gráfico (global, o la zona si hay una sola filtrada: regla 0014, D3), redondeado al paso de cada parámetro,
en un solo `commit`.

## D4. Parámetros sobre el gráfico

Los extremos son parámetros por zona de `clay-distribution` (`phiSand`, `phiShale`), no estado del gráfico: el gráfico
los lee y los escribe con el mecanismo de 0015 (`PLOT_PARAMS`, `commitPlotParams`). Manijas circulares en x = 0 y x = 1
que solo se mueven en vertical (y flechas arriba/abajo); un Ctrl+Z por gesto. `normalizeClayEndpoint` mantiene la lutita
al menos un paso por debajo de la arena (como GR limpio y de arcilla). El módulo avisa si φsand − φsh < 2τ: la diagonal
queda casi horizontal, la banda cubre buena parte del diagrama y la clasificación separa poco; el panel muestra el mismo
aviso.

## D5. Interfaz

Plantilla en «Litología y mineralogía», ejes VSH 0–1 y PHIT 0–0,5, color por GR (o por zona), deshabilitada con el
motivo si falta VSH o PHIT (con el módulo que las calcula). Regiones A (verde azulado) y B (ocre) rellenas al 12 %,
rótulos de las cinco rectas junto a su tramo como en la slide, banda laminar punteada y rótulos «A · arcilla dispersa» y
«B · arcilla estructural» con fondo. Panel aparte: resumen de una línea calculado con el motor («62 % bajo la diagonal:
predomina arcilla dispersa»), extremos, banda, % laminar/dispersa/estructural (sobre las clasificadas) y sin clasificar;
«Estimar de los datos» con la propuesta y sus conteos, o el motivo si no se puede. Ninguna ecuación en la interfaz: están
en `docs` del módulo (módulo Ecuaciones). Capturas: `docs/capturas/thomas-stieber/` (claro y oscuro, pozo sintético y TP).

## D6. Dos arreglos que salieron de la prueba en navegador

- Al cambiar cualquier parámetro, `engineBridge` deja el resultado vacío hasta que llega el nuevo. Con ejes calculados
  (VSH, PHIT) el crossplot pasaba a «Elegí las curvas», el gráfico se desmontaba en medio del arrastre (perdía la captura
  del puntero, no llegaba el `commit`) y la manija quedaba en la posición del arrastre. Ahora el panel conserva la última
  curva de la misma clave mientras `ctx.computed` está vacío (recalculando). No se tocó el motor ni el puente.
- Tabla genérica de Resultados: los conteos (enteros sin unidad) se muestran sin decimales («599», no «599,000») y las
  columnas en % con uno.

## D7. Con el pozo del TP

Probado sobre el HTML construido con «Cargar datos del TP» (`scripts/qa/thomas-stieber.cjs`): 5810 puntos. «Estimar de
los datos» propone φsand 0,157 (77 muestras con Vsh ≤ 0,1) y φsh 0,143 (109 con Vsh ≥ 0,9), que se escriben como 0,155 y
0,145. Los extremos quedan casi iguales: la porosidad total de densidad–neutrón de las lutitas del TP es alta (incluye el
agua ligada) y la de las arenas limpias es moderada, así que la diagonal es casi horizontal y aparece el aviso de D4. Con
esos extremos, por zona (tabla del módulo, % sobre las muestras con dato): A y B predomina estructural (34 % y 73 %), C, D
y E laminar (68 %, 47 % y 59 %); la dispersa no pasa del 14 %. Ese resultado depende mucho de los extremos: con φsand
0,25 y φsh 0,10 (los de fábrica) el pozo completo da 46 % laminar, 29 % dispersa y 26 % estructural. No hay corona del
TP que confirme la distribución.

## Límites

- La clasificación por muestra es orientativa: depende de φsand y φsh, de la calidad de PHIT y VSH (VSH por GR
  sobreestima la arcilla con minerales radiactivos) y de que la arena limpia sea la misma en toda la zona.
- El modelo supone mezclas de dos extremos (arena limpia y lutita) con porosidades fijas; la compactación de la arcilla
  dispersa y la porosidad secundaria lo corren.
- Para confirmar la distribución hacen falta corona (lámina delgada, SEM), imágenes de pozo o RMN.

## Fuentes

- Thomas, E.C. y Stieber, S.J. (1975). The distribution of shale in sandstones and its effect upon porosity. SPWLA 16th
  Annual Logging Symposium.
- Cátedra de Interpretación de Perfiles (FIUBA), Clase 8, slides 12–14 («Mineralogía de arcillas»).
