# F26 · Asistente sin modelo

1. Cargá **Datos del TP** y elegí **Entrar al pozo**. Abrí **Asistente** desde el menú de paneles o desde la
   paleta con **Abrir la pestaña Asistente**.
2. Elegí **Mostrame Sw en la zona D** y pulsá **Mostrar SW en la zona D**. Comprobá el nuevo intervalo del visor y
   el foco en la leyenda de Sw.
3. Preguntá **¿Por qué la zona C tiene poco pay?**. La respuesta cita el Sumario por zona y ofrece abrirlo o acudir
   a Cutoffs. Preguntá **¿Qué pasa si muevo el cutoff de Sw a 65 % en la zona D?** para comparar con el barrido.
4. Preguntá **¿Cómo funciona Archie?** y abrí su ficha de Ecuaciones. Con **Quiero abrir el crossplot**, el asistente
   ofrece un comando de la paleta como sugerencia.
5. En **Geología**, consultá **¿Cuánto pay hay en la zona D?**. **Abrir Sumario** vuelve a Petrofísica y muestra el
   paso correspondiente.

## Repetición automatizada

```sh
npm ci
npm run typecheck
npm test
npm run build
find dist -type f
npm install --prefix /tmp/f26-browser playwright
export QA_PLAYWRIGHT=/tmp/f26-browser/node_modules/playwright
export QA_CAPTURAS=docs/capturas/f26
node scripts/qa/asistente.cjs
```

Para probar el mismo HTML por HTTP local, iniciá el servidor y corré el recorrido en otra terminal.

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory dist
```

```sh
QA_URL=http://127.0.0.1:8766/index.html node scripts/qa/asistente.cjs
```

El script deshabilita la red antes de abrir por `file://` y después de cargar por HTTP local.

## Apertura local

Chromium administrado 156.0.8078.79 bloqueó la prueba sin red por `file://` con el siguiente error.

```text
page.goto: net::ERR_BLOCKED_BY_ADMINISTRATOR at file:///workspace/interpretaci-n-pozo/dist/index.html
```

La apertura sin red por doble clic queda pendiente. La prueba por HTTP carga el mismo HTML y deshabilita la red
antes de cargar el pozo del TP y de consultar el asistente.

## Resultados

- Base `main@d3f10ff`. `npm run typecheck`, `npm test` (3.857 pruebas en 244 archivos) y `npm run build` pasaron. Vite produjo solo `dist/index.html`
  (8.575.346 bytes, SHA-256 `e89a50999550c6aa4387e8d2dfed9937533268d3dd4bdb209110f2eeb35cef23`).
- El guion de 20 preguntas usa el CSV del TP y el motor real. Las pruebas adicionales comprueban cifras de las tablas,
  umbrales evaluados, resultados pendientes, zonas ambiguas, totales y sugerencias de navegación.
- Por HTTP local, con la red deshabilitada tras cargar la página, el visor se desplazó a la zona D
  (7970,1–8247,0 m MD) y enfocó la leyenda de Sw. La consulta sobre la zona C citó `ZONE_SUMMARY` con 63,86 m de
  espesor bruto, 5,33 m de reservorio neto y 2,13 m de pay.
- El recorrido contrastó el barrido para el cutoff de Sw de 65 %, abrió la ficha de Archie en Ecuaciones, sugirió
  Crossplot ante una consulta no reconocida y abrió Sumario desde Geología. Registró cero errores de página y
  cero solicitudes externas.
- La revisión independiente verificó las correcciones de navegación entre espacios, selección de la fuente activa,
  foco en leyendas adicionales, resultados cacheados de zona, alcance de totales y selección de métodos por ID.

[Claro](asistente-claro.png) · [Oscuro](asistente-oscuro.png), 1366 × 768.
