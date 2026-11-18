# F18 · Curva fantasma

La rama parte de `main` en `f92f86c`, el squash de F14 (PR #93). La integración de F18 fue autorizada con la
apertura por doble clic sin verificar debido al bloqueo de Chromium administrado.

## Recorrido con el pozo del TP

1. Cargar los datos del TP y mostrar 7800–7930 m. Hacer clic derecho cerca del trazo de GR, elegir «Calcar un tramo de
   GR» y arrastrar en Correlación de 7820 a 7860 m. Esc cancela antes de arrastrar o durante la selección.
2. Arrastrar la manija hacia abajo. El aviso inferior muestra el desplazamiento firmado en MD. Con el perfil activo
   tras el arrastre, ↑ y ↓ lo ajustan. Tab también alcanza el calco, Mayús multiplica el paso por diez y Esc devuelve
   el foco al perfil. Acercar con +, panear con Av Pág y quitarlo con «Quitar calco».
3. Repetir sobre AT90 en Resistividad, con escala de 0,2–2000 Ω·m. Para DT, mostrar aproximadamente 8450–8518 m y
   copiar 8482–8516 m. DT tiene un hueco terminal desde 8508,0348 m en el CSV del TP. Al desplazar hacia arriba,
   el calco conserva ese tramo sin trazo. `tests/viewer-ghost.test.ts` comprueba también los cortes interiores en
   las coordenadas dibujadas para NaN y cero en log.
4. Guardar el proyecto al entrar y de nuevo con el calco de DT activo. El recorrido compara en profundidad el
   contenido JSON de ambos proyectos. Cargar el pozo de demostración y verificar que desaparezcan el aviso y el foco
   del calco. La prueba automatizada incluye además la cancelación por `pointercancel`.

Capturas de Chromium en 1366 × 768 con el mismo HTML de entrega:

- [GR en claro](gr-claro.png)
- [AT90 logarítmica en oscuro](resistividad-oscuro.png)
- [DT con hueco en oscuro](dt-hueco-oscuro.png)

## Comandos y resultados

```sh
npm ci
npm run typecheck
npm test
npm run build
find dist -type f
node scripts/qa/alignment-benchmark.mjs /tmp/f18-alignment.json
node scripts/qa/filtering-benchmark.mjs /tmp/f18-filtering.json
```

Typecheck aprobado. Suite completa de 240 archivos y 3798 pruebas aprobada. El build produjo un único archivo,
`dist/index.html` (8,53 MB). Los benchmarks de preparación con 100.000 muestras coincidieron con sus referencias
independientes. Medianas de 65,87 ms para alineación y 83,03 ms para filtrado. Ambos se ejecutaron antes de iniciar
Chromium. Esas mediciones corresponden a preparación de datos.

Con Chromium 156 administrado y `playwright-core` instalado en un directorio temporal:

```sh
npm install --prefix /tmp/f18-browser playwright-core
QA_PLAYWRIGHT=playwright-core NODE_PATH=/tmp/f18-browser/node_modules node scripts/qa/curva-fantasma.cjs
```

Con `setOffline(true)` desde antes de navegar, Chromium devolvió
`page.goto: net::ERR_BLOCKED_BY_ADMINISTRATOR at file:///workspace/tp/dist/index.html`.

Prueba separada por HTTP local. En una terminal:

```sh
python -m http.server 4173 --bind 127.0.0.1 --directory dist
```

En otra terminal:

```sh
QA_URL=http://127.0.0.1:4173/index.html QA_PLAYWRIGHT=playwright-core \
  NODE_PATH=/tmp/f18-browser/node_modules node scripts/qa/curva-fantasma.cjs
```

El navegador deshabilitó la red inmediatamente después de cargar el HTML. El recorrido del TP pasó, con proyectos
JSON idénticos, cero errores de página y cero solicitudes HTTP/HTTPS externas. La apertura por `file://` sigue
pendiente de comprobar en un navegador que permita abrir archivos locales.
