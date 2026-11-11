# 0070 — Marca de fiubaLog y fondo de Inicio

- Estado: aceptada (pedido de la usuaria: «un logo épico y elegante» y evaluar ideas de diseño de referencia).
- Alcance: `src/ui/components/Brand.tsx` y `brand.css` (nuevos), `src/ui/tokens.ts` (`BASE_TOKENS.brand`),
  `src/ui/components/Icon.tsx` (sale la marca vieja), `src/ui/index.ts`, `src/ui/showcase/DesignSystemPage.tsx`,
  `src/app/home/` (`HomeScreen.tsx`, `home.css`), `src/app/shell/` (`TopBar.tsx`, `SmallScreenNotice.tsx`),
  `index.html` (favicon); en una segunda pasada, `src/ui/brandSvg.ts`, `FileDrop`, `EmptyState`, el diálogo de carga
  (`src/app/components/LoadWellDialog.tsx`), el informe (`src/app/report/report.ts`), el indicador del motor y el
  grabador SVG de figuras (`src/io/export/figures/svg.ts`). Amplía la 0065 (Inicio), la 0004 (sistema de diseño) y la
  0012 (figuras).
  Capturas antes/después: `docs/capturas/marca/`.

## Contexto

La marca era un cuadrado violeta del color de acento con un zigzag blanco: correcta, pero genérica (se confundía con
cualquier ícono de «actividad») y sin presencia en Inicio, donde el nombre era texto plano. Se evaluaron además diez
recursos de referencia para que una interfaz «no se vea plana»: gradientes térmicos, grillas tipo plano, ondas de agua,
grafito moteado, vidrio acanalado, curvas de nivel, gradiente granulado, paisajes monocromos, textura de pasto y
sombras suaves, más tres paletas de dos colores y un acento.

## Decisión

### La marca: un perfil sobre papel de perfil, con el gradiente geotérmico

- **Cuadro de tinta** (`brand.ink` → `brand.inkDeep`), igual en los dos temas: en claro se lee como un ícono de
  aplicación; en oscuro se despega por el borde con brillo.
- **Traza blanca de rayos gamma** que baja por el cuadro con carácter de perfil real: arcilla a la derecha, una arena
  en bloque, arcilla, una arena delgada y, al pie, una **secuencia granocreciente** (embudo). No es una sinusoide: los
  prototipos sinusoidales se leían como una víbora o un rayo.
- **Relleno térmico** a la derecha de la traza: frío arriba (`thermal1`, lavanda) y caliente en profundidad
  (`thermal4`, naranja), como el gradiente geotérmico. Es la idea «thermal gradient» con significado propio del
  dominio, y el relleno (no solo el trazo) hace que la marca se reconozca a 16 px.
- **Dos dibujos**: compacta hasta 39 px (traza simplificada, trazo grueso, sin grilla) y detallada desde 40 px (grilla
  de papel de perfil sobre la tinta, contactos de estratos, brillo bajo la traza, resplandor cálido al pie y un grano
  muy tenue). En Inicio, `animate` registra la traza de arriba hacia abajo en 1,5 s; con movimiento reducido no anima.
- **Wordmark**: «fiuba» liviano y «Log» semibold. En el título de Inicio, «Log» lleva el gradiente térmico (más oscuro
  en claro, para conservar contraste de texto grande).
- Se descartó un corte en planta con anillos de invasión: a tamaño chico se leía como una diana.

### Paleta de marca

`BASE_TOKENS.brand` → `--brand-ink`, `--brand-ink-deep`, `--brand-thermal1` … `--brand-thermal4`. Viven en `:root`, no en
los temas. **Solo para la marca y la pantalla de Inicio**: nunca en curvas, datos ni controles (el color de acento de la
interfaz sigue siendo el índigo de 0004, y los colores de curva siguen la paleta curada por rol).

### Ideas de referencia: qué entra y dónde

| Idea | Decisión | Motivo |
|---|---|---|
| Gradiente térmico | **Sí**: marca, «Log» del título y resplandor detrás de la sarta en Inicio | Tiene significado (temperatura que crece con la profundidad, módulo de gradientes). |
| Grilla tipo plano | **Sí, como papel de perfil**: grilla logarítmica de 3 décadas × profundidad en el fondo de Inicio y en la marca detallada | Es la grilla real de un perfil impreso; se desvanece desde la sarta hacia los bordes. |
| Gradiente granulado / grafito moteado | **Sí, tenue**: grano en el fondo de Inicio y en la marca detallada | Quita el aspecto plano y el bandeado de los gradientes. |
| Curvas de nivel | No | Compite con la grilla y con la sarta; en geología las isolíneas son datos, no decoración. |
| Sombras suaves | Ya estaba | Los tokens `shadow.*` de 0004 ya son sombras en capas; el emblema suma una sombra térmica propia. |
| Ondas de agua, vidrio acanalado, paisajes monocromos, pasto | No | Fotográficos o ilusionistas: sin relación con el dominio, pesan en un HTML único y distraen. |
| Paletas de dos colores + acento | Solo la idea | El índigo de acento + un acento cálido es justamente el par de la marca; no se cambia la paleta de la interfaz. |

**Donde se leen datos no cambia nada**: el visor, los gráficos y los paneles siguen neutros. La prioridad 2 del proyecto
pide una interfaz moderna *respetando las convenciones de lectura del perfil*; un fondo con textura o gradientes detrás
de las pistas compite con los rellenos y los colores de curva.

### Fuera de los datos: los bordes del trabajo

La marca sí entra en las superficies que rodean el trabajo y no muestran curvas:

- **Zona para soltar archivos** (`FileDrop`, la usan la carga de pozo, la corona y el digitalizador): papel de perfil
  tenue detrás del texto, que toma el color de acento al pasar o arrastrar; el ícono en un cuadro de marca
  (`.ui-brand-tile`: tinta con el filo térmico al pie) que se levanta al pasar.
- **Diálogo «Cargar pozo»**: filo térmico arriba (el primer diálogo del trabajo) y la tarjeta «Datos del TP» con el
  mismo cuadro de marca.
- **Estados vacíos** (`EmptyState`, ~30 en los paneles de módulos): papel de perfil dentro del cuadro del ícono y el
  filo térmico al pie. Se resuelve en el componente, sin tocar los módulos. El espacio de trabajo sin pozo no existe
  como estado (la app arranca en Inicio o con la demostración), así que no hay una pantalla vacía que diseñar.
- **Informe**: marca, nombre y «Interpretación de perfiles · FIUBA» arriba, con una franja térmica que se imprime
  (`print-color-adjust: exact`). La marca va como SVG en línea generado por `brandMarkSvg` (`src/ui/brandSvg.ts`, puro;
  la misma geometría que el componente), sin filtros para que imprima igual en cualquier navegador.
- **Indicador del motor**: el giro de «Calculando…» usa los colores de la marca; listo y error siguen verde y rojo.
- **Las figuras exportadas no llevan marca**: van dentro del informe o de la entrega del TP y tienen que poder usarse
  sueltas.

La textura de papel de perfil se define una vez como `--brand-logpaper` (máscara blanca, en `brand.css`).

### Arreglo encontrado de paso: nombres de zona en las figuras SVG

El perfil clásico (0067) dibuja el nombre de cada zona con un halo (`strokeText`), que el grabador SVG de figuras no
implementaba: la superposición de zonas fallaba en cada figura del perfil (dos errores de consola al generar el
informe, ya presentes en `main`) y los nombres no salían. El grabador ahora implementa `strokeText` como el mismo
`<text>` sin relleno y con el trazo vigente; la pantalla no cambia y las figuras recuperan los nombres con su halo.

### Costo

Las capas de Inicio son estáticas y van en un solo elemento (`.home__backdrop`: grano + resplandor + fondo), más la
grilla enmascarada. Un primer intento con un resplandor animado con `blur` y grano con `mix-blend-mode` se descartó por
el costo de recomponer en cada cuadro de la escena 3D. `scripts/qa/inicio.cjs`: 50/50. La medida de cuadros por segundo
en reposo con SwiftShader varía demasiado entre corridas (2,7 a 12 sin cambios) para comparar; en un equipo con GPU
estas capas son texturas fijas.

## Consecuencias

- `BrandMark` se importa de `src/ui` como antes (ahora desde `components/Brand.tsx`); `PRODUCT_NAME` pasa a `src/ui`.
- El favicon es la marca compacta en SVG embebido (sigue funcionando sin internet).
- Un componente nuevo con ícono destacado puede usar `.ui-brand-tile`; un fondo vacío, `--brand-logpaper` como máscara.
  Ninguno de los dos va detrás de datos.
- La marca no cambia con el tema: si se agrega un tema nuevo, no hay que tocarla.
