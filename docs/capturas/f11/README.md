# F11 · Rangos de ejes del crossplot a mano

1. Cargá **Datos del TP**, entrá al pozo y abrí **Crossplot**. Agrandá el panel para ver los controles y el gráfico juntos.
2. Elegí GR en X con escala **Lin** y AT90 en Y con escala **Log**. En X, ingresá `-10,5` y `180`.
   Confirmá con Enter o Tab. En Y, ingresá `0,1` y `100`. Verificá que cada edición preserve los límites del otro eje.
3. Probá un campo vacío, `1e999`, límites iguales o invertidos y un límite ≤ 0 en log. Cada intento debe mostrar
   el error y recuperar el valor vigente sin cambiar el gráfico.
4. Filtrá por zona D y agregá un cutoff libre en X. Mové su manija con →. Debe bajar el conteo por zona y moverse
   el cutoff sin cambiar los límites fijos.
5. Guardá el proyecto. Restablecé X y cambiá la curva de Y. Ambos vuelven a automático. Reabrí el archivo
   y comprobá los rangos, la zona filtrada y el cutoff. Cambiá Y de log a lineal y de vuelta a log para verificar
   el restablecimiento por escala. Volvé a elegir la escala activa con un rango fijo para comprobar que se conserva.
6. Cargá el pozo de demostración desde la paleta de comandos. Fijá un rango ahí y alterná con el pozo del TP.
   Cada pozo recupera sus propios límites.

[Claro](rangos-crossplot-claro.png) · [Oscuro](rangos-crossplot-oscuro.png), 1366 × 768.

## Repetición automatizada

```sh
npm run typecheck
npm test
npm run build
find dist -type f
npm install --prefix /tmp/f11-browser playwright-core
QA_PLAYWRIGHT=playwright-core NODE_PATH=/tmp/f11-browser/node_modules node scripts/qa/rangos-crossplot.cjs
```

El guion deshabilita la red antes de navegar por `file://`. Para repetir con HTTP local, serví el mismo HTML:

```sh
python -m http.server 4173 --bind 127.0.0.1 --directory dist
```

En otra terminal:

```sh
QA_URL=http://127.0.0.1:4173/index.html QA_PLAYWRIGHT=playwright-core \
  NODE_PATH=/tmp/f11-browser/node_modules node scripts/qa/rangos-crossplot.cjs
```

La variante HTTP deshabilita la red inmediatamente después de la carga y verifica que el navegador no haya
solicitado recursos HTTP/HTTPS externos. El guion prueba también la apertura de un proyecto del mismo formato
sin los campos de rango, que eran opcionales antes de F11.

## Resultados del 18 de noviembre de 2026

- `npm run typecheck` y `npm run build` pasaron. El build produjo únicamente `dist/index.html`.
- Chromium administrado rechazó la apertura directa con
  `net::ERR_BLOCKED_BY_ADMINISTRATOR at file:///workspace/interpretacion-pozo/dist/index.html`.
  La apertura por doble clic sin internet queda pendiente.
- El mismo HTML pasó el recorrido por HTTP local con la red deshabilitada después de cargar. Se comprobaron
  ambos ejes, errores, restablecimiento, intercambio, cambios de curva y escala, persistencia por pozo, guardado
  y reapertura, y apertura sin rangos guardados. El filtro D redujo el conteo de 5810 a 1818 y la manija movió
  el cutoff libre. Hubo cero errores de página y cero solicitudes HTTP/HTTPS externas.
- En la primera ejecución completa de `npm test`, pasaron 3804 de 3805 pruebas. La prueba de suspensión de una
  fuente manual con curva apagada, en `tests/tool-string.test.ts`, superó el umbral de 5000 ms.
  La repetición focalizada `npm test -- --maxWorkers=1 tests/tool-string.test.ts` pasó las 30 pruebas de ese
  archivo con el mismo umbral. La suite completa solo se ejecutó una vez.
