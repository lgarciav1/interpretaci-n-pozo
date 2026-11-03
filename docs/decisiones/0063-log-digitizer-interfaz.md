# 0063 — Log Digitizer: interfaz (mesa de digitalización)

- Estado: implementada (fase 2). Motor sin cambios: [0062](0062-log-digitizer-motor.md).
- Alcance: `src/modules/digitizer/` (módulo de panel), `Dialog size="full"` en `src/ui/`, botón «Digitalizar
  registro» en «Datos del pozo», pruebas en `tests/digitizer-ui/` y `tests/modules-digitizer.test.ts`, guion de
  navegador `scripts/qa/log-digitizer.cjs`, capturas en `docs/capturas/log-digitizer/`.

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

## Pendiente

- Perspectiva con 4 esquinas: implementada en la interfaz pero sin validar de punta a punta en el navegador.
- «Abrir sesión»: probado con tests (ida y vuelta, archivos dañados), no en el navegador.
- Pulido y atajos adicionales; un panel de ajustes finos del trazado (umbral, saltos) no está expuesto.
- La curva agregada sin rol no aparece en las pistas de la plantilla de fábrica del visor (se verificó en «Datos del
  pozo»); falta comprobar y documentar cómo ubicarla en una pista propia.
- Límites del motor (0062): sin PDF/TIFF, sin OCR, sin curvas que «dan la vuelta», cruces del mismo color → modo
  guiado.
- Lectura de PDF: anotada como fase futura en [0064](0064-log-digitizer-lectura-de-pdf.md) (propuesta, no
  implementada).
