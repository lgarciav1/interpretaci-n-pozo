# 0070 — Marca de fiubaLog y fondo de Inicio

- Estado: aceptada (pedido de la usuaria: «un logo épico y elegante» y evaluar ideas de diseño de referencia).
- Alcance: `src/ui/components/Brand.tsx` y `brand.css` (nuevos), `src/ui/tokens.ts` (`BASE_TOKENS.brand`),
  `src/ui/components/Icon.tsx` (sale la marca vieja), `src/ui/index.ts`, `src/ui/showcase/DesignSystemPage.tsx`,
  `src/app/home/` (`HomeScreen.tsx`, `home.css`), `src/app/shell/` (`TopBar.tsx`, `SmallScreenNotice.tsx`),
  `index.html` (favicon). Amplía la 0065 (pantalla de Inicio) y la 0004 (sistema de diseño).
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

**El espacio de trabajo no cambia**: el visor, los gráficos y los paneles siguen neutros. La prioridad 2 del proyecto
pide una interfaz moderna *respetando las convenciones de lectura del perfil*; un fondo con textura o gradientes detrás
de las pistas compite con los rellenos y los colores de curva. Ahí la marca aparece solo en la barra superior.

### Costo

Las capas de Inicio son estáticas y van en un solo elemento (`.home__backdrop`: grano + resplandor + fondo), más la
grilla enmascarada. Un primer intento con un resplandor animado con `blur` y grano con `mix-blend-mode` se descartó por
el costo de recomponer en cada cuadro de la escena 3D. `scripts/qa/inicio.cjs`: 50/50. La medida de cuadros por segundo
en reposo con SwiftShader varía demasiado entre corridas (2,7 a 12 sin cambios) para comparar; en un equipo con GPU
estas capas son texturas fijas.

## Consecuencias

- `BrandMark` se importa de `src/ui` como antes (ahora desde `components/Brand.tsx`); `PRODUCT_NAME` pasa a `src/ui`.
- El favicon es la marca compacta en SVG embebido (sigue funcionando sin internet).
- La marca no cambia con el tema: si se agrega un tema nuevo, no hay que tocarla.
