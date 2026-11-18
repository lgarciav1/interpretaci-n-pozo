# F15 · Bandas de incertidumbre en el pozo del TP

1. Cargá **Datos del TP** y elegí **Entrar al pozo**.
2. En el menú de plantillas del visor, elegí **Petrofísica esencial** para ver φ y Sw en pistas separadas. En la
   plantilla de fábrica, la pista **Porosidad · Sw** ofrece ambos controles en el mismo encabezado.
3. En cada pista, el botón **Mostrar banda de incertidumbre** enciende o apaga el relleno P10–P90 de la curva
   indicada (φ ↔ o Sw ↔). Probá ambos apagados, solo Sw, ambos encendidos y solo φ.
4. En **Saturación**, mové el exponente n con las bandas encendidas. El visor indica que quedaron desactualizadas
   hasta que llega el nuevo cálculo.
5. En el panel **Incertidumbre del volumen**, usá mínimo y máximo iguales a 1 para cada multiplicador si querés ver
   el caso sin dispersión. La banda colapsa sobre la curva activa. Los rangos por defecto son 0,9 y 1,1.

## Repetición automatizada

```sh
npm ci
npm run typecheck
npm test
npm run build
find dist -type f
npm install --prefix /tmp/f15-browser playwright
export QA_PLAYWRIGHT=/tmp/f15-browser/node_modules/playwright
export QA_CAPTURAS=docs/capturas/f15
node scripts/qa/bandas-incertidumbre.cjs
```

Chromium administrado 156.0.8078.79 bloqueó la apertura por `file://` con la red deshabilitada. Error exacto:

```text
page.goto: net::ERR_BLOCKED_BY_ADMINISTRATOR at file:///workspace/interpretaci-n-pozo/dist/index.html
```

Para repetir con el mismo HTML por HTTP local, ejecutá lo siguiente.

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
```

En otra terminal, con las mismas variables:

```sh
QA_URL=http://127.0.0.1:8765/index.html node scripts/qa/bandas-incertidumbre.cjs
```

El script deshabilita la red después de cargar por HTTP. La apertura por doble clic sin conexión queda pendiente.

## Resultados

- Base `main@ef6b129`. Pasaron `npm run typecheck`, `npm test` (3.832 pruebas en 243 archivos) y `npm run build`.
  El build produjo solo `dist/index.html` (8.562.899 bytes, SHA-256 `f40d0ff774c1a9f60e988b956f4375aef0b89a42a706a025400bb263eaccc103`).
- Las pruebas numéricas contrastaron las tres distribuciones, los límites físicos, los faltantes y el colapso exacto
  con dispersión cero. El recorrido offline por HTTP usó las 5.810 muestras del TP. Las cuatro combinaciones
  cambiaron el dibujo sin enviar pedidos adicionales a ningún worker. Al mover el slider de saturación, volvió a
  correr el motor y el aviso de bandas desactualizadas se retiró al completarse el nuevo cálculo. Se registraron
  cero solicitudes externas y cero errores de página.
- En la zona D, cuatro muestras contiguas entre 7996,2756 y 7996,7328 m MD cruzaron el cutoff de Sw máxima (0,60 v/v).
  A 7996,5804 m MD se obtuvo Sw = 0,593366, P90 = 0,560566 y P10 = 0,626166 v/v.
- El revisor independiente contrastó los cuantiles y verificó los arreglos en la validación de rangos, el aviso del
  visor, la separación de claves del dibujo y la cancelación de respuestas tardías. El modelo representa error
  sistemático relativo. El efecto de la calidad local del dato queda pendiente de calibración.

[Claro](bandas-claro.png) · [Oscuro](bandas-oscuro.png), 1366 × 768.
