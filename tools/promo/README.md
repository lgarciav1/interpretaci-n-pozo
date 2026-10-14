# Video promocional

Fuentes del video `docs/promo/promo-interpretacion-de-pozo.mp4` (1920×1080, 60 fps, 80 s, con música original).
Todo se genera desde este repositorio: capturas reales de la app, las curvas del pozo del TP y una banda sonora
sintetizada. No usa material de terceros.

## Cómo se arma

| Archivo | Qué hace |
|---|---|
| `capture.mjs`, `capture-lib.mjs` | Abre la app (servidor de desarrollo en `:5173`), carga los datos del TP, recorre los 11 pasos y saca las capturas a 2× en `shots/` (visor, crossplot, histograma, MDT, corona, sarta 3D, ecuaciones, tema claro). |
| `crop.py` | Recorta las capturas en los encuadres del video (`assets/`). |
| `prep.py` | Lee `datos/pozo_tp_perfiles.csv` y deja las curvas submuestreadas en `data.js` (las que se dibujan solas en la segunda escena). |
| `music.py` | Sintetiza la banda sonora (`music.wav`, 96 BPM, Re mayor): pad, bajo, arpegio con delay, percusión suave, impactos y reverb por convolución, sincronizados con los cortes. |
| `promo.html` | La composición: 13 escenas animadas con una función pura `render(t)` (sin transiciones CSS), así cada cuadro es reproducible. |
| `render.mjs` | Pide cada cuadro a Chromium y lo entuba a ffmpeg (H.264). |
| `build.sh` | Corre todo en orden y une video y audio. |

Requisitos: `npm ci`, Python 3 con numpy y Pillow, ffmpeg y Playwright con Chromium. Si Playwright no está en el
proyecto, `PLAYWRIGHT_MODULE=/ruta/a/playwright/index.mjs ./build.sh`.

Para revisar una escena sin renderizar todo, abrir `promo.html` en Chromium con `--allow-file-access-from-files` y
llamar `render(t)` desde la consola (t en segundos).

## Guion

| Tiempo | Escena |
|---|---|
| 0–7,5 s | Apertura: el pozo desciende, «Bajo la superficie, cada metro cuenta una historia.» |
| 7,5–15 s | GR, resistividad, densidad–neutrón y sónico del pozo del TP se dibujan en profundidad. |
| 15–20 s | Marca y título. |
| 20–27,5 s | La app completa en pantalla; once pasos guiados. |
| 27,5–32,5 s | Visor multipista. |
| 32,5–37,5 s | Presiones MDT: gradientes, densidad de fluido y contactos (ejemplo sintético de la app). |
| 37,5–48,75 s | Crossplot libre, histograma y datos de corona. |
| 48,75–53,75 s | Tendencias: lineal, log, exponencial y potencial con ecuación y R². |
| 53,75–58,75 s | Motor petrofísico: ecuaciones, 46 métodos documentados, 2.371 pruebas. |
| 58,75–63,75 s | Sarta de perfilaje en 3D. |
| 63,75–68,75 s | Cifras: 45 módulos, 11 pasos, 2.371 pruebas, 1 archivo HTML. |
| 68,75–72,5 s | Tema claro y oscuro. |
| 72,5–80 s | Cierre. |

Las cifras salen del repositorio al momento de generar el video (módulos registrados, pasos del flujo, `npm test`,
cantidad de métodos del módulo Ecuaciones); si cambian, actualizarlas en `promo.html`.
