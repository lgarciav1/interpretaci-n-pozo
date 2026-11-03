# 0063 — Log Digitizer: interfaz (mesa de digitalización)

- Estado: implementada (fase 2). Motor sin cambios: [0062](0062-log-digitizer-motor.md).
- Alcance: `src/modules/digitizer/` (módulo de panel), `Dialog size="full"` en `src/ui/`, botón «Digitalizar
  registro» en «Datos del pozo», pruebas en `tests/digitizer-ui/` y `tests/modules-digitizer.test.ts`, guion de
  navegador `scripts/qa/log-digitizer.cjs` y `scripts/qa/log-digitizer-perspectiva-sesion.cjs` (con su generador
  `scripts/qa/make-digitizer-scan.py`), capturas en `docs/capturas/log-digitizer/`.

## Qué hay

- **Módulo de panel** `digitizer` (como «Preparar datos», 0058): definición pura con `docs` para Ecuaciones (calibración
  lineal por tramos y por mínimos cuadrados, escala lineal/log, inclinación, homografía con normalización de Hartley,
  ΔE CIELAB, costo del trazado de Viterbi, remuestreo), categoría nueva «Adquisición de datos», registrado en
  `PANEL_MODULES`. No es un nodo del motor petrofísico.
- **Entradas**: pestaña del dock «Digitalizar» (resumen de la sesión y «Abrir mesa de digitalización»), acción de la
  paleta «Abrir Log Digitizer» (habilitada también sin pozo) y botón «Digitalizar registro» en «Datos del pozo». El
  botón ejecuta la acción por su id (`digitizer:open`): la app no importa el módulo.
- **Mesa a ventana completa**: `Dialog` del sistema de diseño con `size="full"` (agregado a `src/ui`), montado por la
  pestaña del dock (las pestañas están siempre montadas), así no se toca el armazón. Cerrarla no pierde nada: el
  estado vive en un store de zustand del módulo.
  - Pasos con estado visible (`Stepper`): Imagen · Geometría · Profundidad · Curvas · Revisión · Importar y exportar.
  - Lienzo canvas: zoom con la rueda alrededor del puntero, desplazamiento arrastrando (herramienta Mover, barra
    espaciadora o botón del medio), cruz de lectura con profundidad y valor en vivo, vistas Original / Corregida /
    Máscara, superposiciones (puntos de inclinación y esquinas, amarres con su profundidad, regla de profundidad,
    bordes con sus valores, región, guía y corredor, trazas en el color complementario de la tinta).
  - Herramientas: inclinación (2 puntos), esquinas (4), amarres (clic + profundidad en m o ft), bordes izquierdo y
    derecho, cuentagotas, colores sugeridos, negro sobre claro, región, guía (modo guiado), y edición manual: pintar
    (arrastrar a lo largo de la curva), borrar tramo y agregar puntos, con deshacer/rehacer PROPIO de la mesa
    (Ctrl+Z dentro de la mesa no toca el proyecto; un gesto es un paso). Mediana móvil y quitar picos, apagados.
  - Revisión: mensajes de calidad del motor (cobertura, saltos, temblor, confianza; Buena / Revisar / Mala) y vista
    previa en pistas con la curva del pozo activo del mismo rol en gris.
  - Salida: «Agregar al pozo activo» (remuestreo al índice del pozo, un `commit` deshacible), «Crear pozo nuevo»
    (paso uniforme en m o ft), «Exportar LAS» y «Exportar CSV» (grilla uniforme común).
  - Texto de precisión (1–2 % del rango con ~20 px/m) en el pie y en el paso Imagen; límites en la ayuda («?»).
- **Worker propio** (`digitizer.worker.ts`, `?worker&inline` → un solo HTML, funciona por `file://`): geometría,
  máscaras, colores sugeridos y trazado, con progreso. Las imágenes se envían una vez por clave. Cancelar termina el
  worker y el próximo pedido crea otro y reenvía la imagen. Sin `Worker` (Vitest) el mismo servicio corre en el hilo
  principal (`worker/protocol.ts`, `worker/client.ts`).
- **Lógica pura testeada** (`model/`): vista (pantalla ↔ imagen, zoom), formulario → tipos del motor, pasos, edición
  de trazas, política de importación, archivo de sesión. Convención del proyecto (`tests/modules.test.ts`): los `.ts`
  del módulo son puros; lo que usa zustand o la interfaz va en `.tsx` (`store.tsx`, `actions.tsx`) o en `draw.ts`.

- **«Mostrar en el visor»** (paso Importar y exportar, tras «Agregar al pozo activo»): las pistas de fábrica se arman por
  rol, así que una curva que entró sin rol (el pozo ya tenía esa curva, política de abajo) no aparece sola. El botón crea
  **una pista propia por curva**, a la derecha de la columna de profundidad (al final de la lista quedaría fuera de la
  vista: el visor es angosto), con un selector `{ curveId }` y la **escala impresa del registro** (bordes izquierdo y
  derecho; invertida si el mayor está a la izquierda). Un solo paso de deshacer («Mostrar GR_DIG en el visor»); no
  duplica una curva que ya está en alguna pista; la pista pasa a las pistas propias del espacio (la plantilla deja de ser
  «De fábrica»). Es una acción de la persona, no un efecto de agregar: agregar curvas no cambia el visor solo. La acción
  carga de forma diferida `viewerOverlayList` (importa los módulos, entre ellos este: una importación estática sería
  circular).

## Qué se persiste y dónde

- **Proyecto (formato v7 sin cambios)**: solo la curva agregada, como curva medida del pozo
  (`origin = { kind: 'measured', source: 'Log Digitizer' }`). Sobrevive a guardar y abrir (test y navegador).
- **Sesión de la mesa**: en memoria mientras la app está abierta. «Guardar sesión» descarga un JSON aparte del proyecto
  con la `DigitizerSession` del motor, la imagen original incrustada en base64 (sus bytes JPG/PNG/WebP) y `extras`
  (amarres sin profundidad, curvas a medio definir, suavizado). Al abrir se valida con `validateSession` y se compara la
  huella de la imagen (`sessionMatchesImage`). Avisa si pasa de 5 MB.

## Roles y mnemónicos repetidos

Por defecto (`importPlan`): si el pozo ya tiene una curva con el rol de la digitalizada, entra **sin rol** (el motor
sigue usando la existente y ningún resultado cambia solo); si el mnemónico existe, entra con sufijo `_DIG` (`_DIG2`…).
La persona puede pedir «Conservar el rol»: el motor sigue eligiendo la curva original por defecto y la digitalizada
queda como candidata en el selector de fuentes.

## Validación en el navegador (HTML construido, `file://`, clics reales)

Imagen independiente (800 × 2500 px, 0,4° de inclinación, ruido y JPEG; no generada por el motor): inclinación medida
0,398°, 4 amarres (residuo 0,02 px), bordes, cuentagotas y trazado; LAS exportado contra la verdad:

| Curva | RMSE | % del rango | Correlación | Cobertura |
|---|---|---|---|---|
| GR (0–150) | 1,56 gAPI | 1,04 % | 0,9957 | 99,9 % |
| NPHI (0,45 → −0,15) | 0,0038 v/v | 0,63 % | 0,9906 | 99,6 % |

PNG exportado por la propia app (pozo del TP, Zona B, 1:500, 150 ppp: 11,8 px/m): GR RMSE 3,32 gAPI (2,2 %),
correlación 0,976, cobertura 100 % (limitado por la resolución: cada muestra de 0,1524 m ocupa 1,8 px). Además:
borrar un tramo, deshacer y rehacer en la mesa; agregar al pozo del TP, Ctrl+Z / Ctrl+Mayús+Z en la app, guardar y
reabrir el proyecto con la curva, y releer el LAS exportado con el lector de la app. Sin errores de página.

### Perspectiva, curva sin rol en el visor y «Abrir sesión» (2026-11-03)

Guion `scripts/qa/log-digitizer-perspectiva-sesion.cjs` sobre el HTML construido, por `file://`, con clics reales. Imagen
de `make-digitizer-scan.py` (independiente del motor; solo numpy y Pillow): pista de GR 0–150 gAPI de 900 × 2.700 px con
grilla, marco y ruido, «fotografiada en ángulo» con una homografía conocida (1.060 × 2.850 px). La profundidad está dentro
del pozo del TP (tope 7.800 m) para poder agregarla a él.

- **Perspectiva con 4 esquinas.** Las 4 esquinas del marco se marcan sobre la imagen original; la imagen rectificada
  mide 699 × 2.447 px (lo que dan las esquinas); 4 amarres con residuo 0,00 px; GR contra la verdad: **RMSE 0,245 gAPI
  (0,16 % del rango), correlación 0,99997, cobertura 99,8 %** (492 muestras). La imagen es idealizada (esquinas exactas,
  curva suave, sin deformación del papel): valida la matemática y el flujo, no el comportamiento con una foto real.
- **Curva sin rol en el visor.** El pozo del TP ya tiene GR: la digitalizada entra como `GR_DIG` sin rol y NO está en las
  pistas de fábrica (comprobado). «Mostrar en el visor» crea su pista, que queda dentro del área visible (encabezado a
  552–660 px; con la pista al final de la lista quedaba en 1.637–1.746 px, fuera de la pantalla: lo detectó la prueba de
  control) y muestra la escala 0–150. Ctrl+Z la quita y deja la curva en el pozo; Ctrl+Mayús+Z la devuelve.
- **«Abrir sesión».** Guardar la sesión (5,5 MB, con la imagen incrustada: la app avisa por pasar de 5 MB), recargar la
  página (la mesa queda vacía), abrirla con el selector de archivos: vuelven la perspectiva, los 4 amarres (mismo residuo),
  la curva y su traza, y el LAS exportado es **idéntico** al de antes (mismo RMSE y cobertura). Un JSON que no es una
  sesión se rechaza con «No se pudo abrir la sesión» y la sesión abierta no se pierde. Sin errores de página.
- Pruebas unitarias nuevas de «Mostrar en el visor» en `tests/digitizer-ui/integration.test.ts` (posición de la pista,
  escala impresa, sin duplicar, un solo paso de deshacer, sin curvas).

Capturas: `perspectiva-esquinas-claro`, `perspectiva-corregida-claro`, `visor-ofrece-mostrar-claro`,
`visor-pista-gr-dig-claro`, `sesion-abierta-claro`.

## Pendiente

- Probar con un **escaneo real** (papel, grilla, ruido, rótulos, curvas que se cruzan) y, si hay digital conocida, medir el
  RMSE; ajustar los umbrales de calidad con casos reales (la «fase 3» de 0062 sigue sin un registro real).
- Perspectiva con esquinas marcadas a mano con error (los clics del guion son exactos) y papel deformado.
- Pulido y atajos adicionales; un panel de ajustes finos del trazado (umbral, saltos) no está expuesto.
- Límites del motor (0062): sin PDF/TIFF, sin OCR, sin curvas que «dan la vuelta», cruces del mismo color → modo
  guiado.
- Lectura de PDF: anotada como fase futura en [0064](0064-log-digitizer-lectura-de-pdf.md) (propuesta, no
  implementada).
