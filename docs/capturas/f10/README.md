# F10 · Contacto MDT como tope de zona

## Recorrido

1. Cargar los datos del pozo del TP y abrir la pestaña **MDT**.
2. Elegir **Usar presiones de ejemplo**. El ejemplo es sintético y trae gradientes calculados.
3. En **Contactos**, pulsar la profundidad del contacto gas–petróleo para centrar el visor. Pulsar
   **Usar como tope de zona** en ese contacto.
4. Comprobar que la zona anfitriona quedó partida. El nuevo tope coincide con la muestra MD más cercana y la
   zona inferior conserva la base original y los parámetros de la anfitriona.
5. Intentar aplicar el mismo contacto otra vez. El panel avisa y deja las zonas como están. Pulsar
   Ctrl+Z una vez para restaurar el estado previo y Ctrl+Y para recuperar la división.

[Claro](tope-mdt-claro.png) · [Oscuro](tope-mdt-oscuro.png), 1366 × 768.

## Verificación

```sh
npm run typecheck
npm test
npm run build
find dist -type f
```

El guion `scripts/qa/contacto-mdt-tope.cjs` compara los proyectos guardados antes, después, tras Deshacer
y tras Rehacer. También comprueba que el pozo y los gradientes MDT se conservan. Las pruebas de
`tests/zones-edit.test.ts` cubren un parámetro explícito heredado, el ajuste a la muestra, una base fuera
de grilla, solapes preexistentes y contactos en bordes o huecos.

Para probar el HTML con Chromium administrado:

```sh
npm install --prefix /tmp/f10-browser playwright-core
QA_PLAYWRIGHT=playwright-core NODE_PATH=/tmp/f10-browser/node_modules node scripts/qa/contacto-mdt-tope.cjs
```

Para repetir la prueba por HTTP local, iniciar el servidor en una terminal:

```sh
python -m http.server 4173 --bind 127.0.0.1 --directory dist
```

En otra terminal:

```sh
QA_URL=http://127.0.0.1:4173/index.html QA_PLAYWRIGHT=playwright-core \
  NODE_PATH=/tmp/f10-browser/node_modules node scripts/qa/contacto-mdt-tope.cjs
```

El guion corta la red antes de navegar por `file://` y después de cargar el HTML por HTTP local.

Resultados del 18 de noviembre de 2026:

- Typecheck y suite completa aprobados (241 archivos, 3.804 pruebas). La selección focalizada de zonas
  y MDT pasó 44 pruebas. El build produjo únicamente `dist/index.html`.
- Chromium administrado bloqueó `file://` con
  `net::ERR_BLOCKED_BY_ADMINISTRATOR at file:///workspace/tp/dist/index.html`.
- Por HTTP local con la red deshabilitada tras la carga, el contacto gas–petróleo (8.011,9 m en el
  panel) produjo un tope a 8.011,9728 m. Pasaron el intento repetido, Deshacer y Rehacer, las
  comparaciones de proyectos y las capturas. El navegador registró cero errores de página y cero
  solicitudes HTTP/HTTPS externas.
