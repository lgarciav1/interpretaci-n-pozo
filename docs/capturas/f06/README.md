# F06 · Curvas calculadas por fórmula

1. Cargá **Datos del TP** y elegí **Entrar al pozo**. Si la columna izquierda está plegada, usá **Mostrar datos del pozo**.
2. En **Curvas calculadas**, creá `REL_RT` con `AT90/AT10` y sin unidad. Creá `PHI_HC` con `PHIE*(1-SW)` y unidad `v/v`.
3. En **Armar pistas**, buscá cada mnemónico y elegí **En una pista nueva**. En Crossplot usá `REL_RT` en X y `PHI_HC` en Y. En Histograma seleccioná ambas curvas por turno.
4. Probá guardar `max(2,)` y luego `CURVA_INEXISTENTE`. El editor indica la columna de sintaxis y la referencia ausente. Editá `REL_RT` con la expresión `REL_RT` para comprobar el rechazo del ciclo. Al cerrar el editor debe conservarse `AT90/AT10`.
5. Guardá y reabrí el proyecto desde la paleta de comandos. Exportá en **LAS 2.0** con el sumario desmarcado y comprobá ambas descripciones en `~CURVE INFORMATION`.

## Repetición automatizada

```sh
npm ci
npm run typecheck
npm test
npm run build
find dist -type f
npm install --prefix /tmp/f06-browser playwright
export QA_PLAYWRIGHT=/tmp/f06-browser/node_modules/playwright
export QA_CAPTURAS=docs/capturas/f06
node scripts/qa/curvas-formula.cjs
```

Para la prueba por HTTP, serví el mismo HTML localmente.

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
```

En otra terminal, conservá las mismas variables y ejecutá el recorrido.

```sh
QA_URL=http://127.0.0.1:8765/index.html node scripts/qa/curvas-formula.cjs
```

El recorrido deshabilita la red antes de abrir por `file://` y después de cargar por HTTP local. Contrasta el LAS en siete muestras de las zonas del TP. Calcula el cociente desde las columnas exportadas de resistividad y la fracción de hidrocarburos como `PHIE - PHIE*SW`. El test de integración también contrasta resistividades directamente contra el CSV y usa los resultados de PHIE y SW de una corrida base.

## Entorno de verificación

- Base `main@3e03cc8`, squash del PR #96.
- Vite produjo un solo archivo, `dist/index.html`, de 8.557.135 bytes. SHA-256 `9fabb012956501bd50e471591ac45f867ca97323690031ee56a458eb2a8c6e54`.
- Chromium administrado 156.0.8078.79, con la red deshabilitada antes de abrir por `file://`. El error exacto fue `page.goto: net::ERR_BLOCKED_BY_ADMINISTRATOR at file:///workspace/repo/dist/index.html`. La apertura por doble clic sin internet queda pendiente.
- Revisión independiente del ADR, analizador, grafo, caché y persistencia. El revisor verificó los arreglos del catálogo, los cambios de unidad efectiva, la selección por sarta, la trazabilidad, la poda de caché y la recuperación después de perder una entrada. También abrió los fixtures anteriores y verificó la fórmula y la unidad en los mensajes del motor.

## Resultado del recorrido

HTTP local en `127.0.0.1:8765` con el mismo HTML y la red deshabilitada después de cargar. Ambas curvas quedaron en pistas del visor, el Crossplot mostró 5.795 pares y ambas curvas tuvieron gráfico y estadísticos en Histograma. Se rechazaron el error de sintaxis, la referencia ausente y el ciclo propio. Se guardó y reabrió el proyecto. El LAS posterior conservó ambas expresiones y coincidió con las operaciones de referencia a una tolerancia absoluta de `1e-12`. El recorrido registró cero errores de página y cero solicitudes externas.

[Claro](formula-claro.png) · [Oscuro](formula-oscuro.png), 1366 × 768.

| Índice (desde cero) | MD (m) | REL_RT | PHI_HC (v/v) |
| ---: | ---: | ---: | ---: |
| 1 | 7633,4112 | 0,744297719088 | 0 |
| 598 | 7724,3940 | 1,082453011387 | 0,008031816272 |
| 1080 | 7797,8508 | 0,950829383886 | 0 |
| 2000 | 7938,0588 | 0,902121834360 | 0 |
| 3271 | 8131,7592 | 0,291476903058 | 0 |
| 5154 | 8418,7284 | 0,940917107584 | 0 |
| 5809 | 8518,5504 | 0,158044343377 | 0 |
