# ADR 0095 · Manual visual HTML embebido en la aplicación (100 % sin conexión)

## Contexto

El manual visual del producto (`docs/manual/index.html` + capturas en `docs/manual/img/` y su exportación `docs/manual/FiubaLog-manual.pdf`) describía la aplicación completa pero vivía únicamente como archivo separado en el repositorio. Quien abría la aplicación entregada como único archivo autocontenido (`dist/index.html`) por doble clic (`file://`) no podía consultar el manual desde la interfaz.

Además, `docs/manual/index.html` acumulaba 11 capturas recientes en PNG (`3,52 MB`) sin convertir a WebP y todavía mostraba la versión F26 del Asistente sin las capacidades v2 ni el modo «Preparar defensa».

## Decisión

1. **Optimización y actualización previa del manual (`docs/manual/`):**
   - Convertir los 11 PNG de `docs/manual/img/` a WebP optimizado, sumar las capturas nuevas del **Asistente v2** (`asistente-v2-consultas.webp` y `asistente-v2-defensa.webp`) y actualizar el texto del Capítulo 10 (y accesos en barra superior / paleta), regenerando `docs/manual/FiubaLog-manual.pdf` (~`13,95 MB` mediante JPEG ≤ `1440 px` transcodificado en memoria solo para la impresión PDF).

2. **Empaquetado único sin conexión (`virtual:manual-html`):**
   - En `src/app/manual/inlineManual.ts` (puro, sin React ni `node:fs`), `collectManualImageRefs` descubre todas las imágenes usadas por el manual (atributos `src`/`data-full` y el arreglo `steps` generado por script), `stripExternalLinks` elimina enlaces a Google Fonts para evitar errores de red offline, y `buildStandaloneManualHtml` inyecta cada imagen **una única vez** en `window.__MANUAL_IMAGES__`, sustituye `src="img/..."` estáticos por `data-manual-src` antes del parseo del DOM y resuelve tanto el armado dinámico como el visor ampliado (`#lb-img`) desde un único mapa en memoria.
   - `vite.config.ts` expone `manualHtmlPlugin()` (solo al bundle principal, nunca al worker): devuelve HTML liviano en Vitest, sirve `/__manual__/img/` por middleware en `vite dev` y valida e incrusta las 66 imágenes WebP en `vite build`.

3. **Visor integrado y sincronización bidireccional (`ManualDialog`):**
   - Nuevo ícono de libro en la barra superior (`data-testid="manual-open"`), botón en la pantalla de Inicio (`data-testid="home-manual"`), comando en la paleta (`help:manual`, «Abrir el manual de uso») y sugerencia directa desde el Asistente.
   - `ManualDialog` (`size="full"`, sobre `useUi.manual`) renderiza `<iframe srcDoc>` sin recargarlo ante cambios de tema: recibe y envía mensajes acotados por `window.postMessage` (`fiubalog:manual-theme`, `fiubalog:manual-anchor` y `fiubalog:manual-close` ante `Escape`), verificando `ev.source === iframeRef.current?.contentWindow`.
   - Incluye botones **«Imprimir / PDF»** (`contentWindow.print()`, con respaldo en pestaña nueva) y **«Abrir en pestaña nueva»** mediante `Blob` URL cacheada por tema (`text/html;charset=utf-8`), compatible con `file://` y sin internet.

## Consecuencias

- Todo usuario con `dist/index.html` accede al manual visual completo sin internet, con temas claro/oscuro sincronizados y exportación a PDF en un clic.
- Las capturas se almacenan una única vez por archivo dentro de `dist/index.html`, manteniendo manejable el peso del HTML único sin duplicar activos.
- El test `tests/manual.test.ts` y `vite build` fallan explícitamente si una imagen referenciada por `docs/manual/index.html` falta o queda huérfana en disco.
