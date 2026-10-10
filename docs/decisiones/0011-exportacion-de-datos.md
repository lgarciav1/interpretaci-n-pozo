# 0011 — Exportación de datos (LAS, CSV, Excel)

- Estado: aceptada (fase 6c-1).
- Alcance: `src/io/export/` (escritores puros), `src/app/export/` (diálogo y descarga), botón «Exportar» en
  `src/app/shell/TopBar.tsx`. No cambia el formato de proyecto ni toca `saveProject`.

## Qué

Exportar el pozo activo con las curvas medidas y las calculadas por el motor en LAS 2.0, CSV y Excel, más el sumario por
zona. Se puede elegir curvas, tramo (todo el pozo o una zona), unidad de profundidad (m o ft) y el valor de los datos
faltantes.

## Decisiones

- **Escritores puros sobre una entrada común** (`ExportInput`): profundidad en metros y columnas con mnemónico, unidad,
  descripción y origen. La interfaz solo arma la entrada y descarga; los escritores corren en Node y se testean con
  ida y vuelta contra NUESTROS lectores (`readWellFile`, `parseTable`).
- **Calculadas activas por defecto.** Las salidas que alimentan la cadena; las alternativas (módulos en `compare`) solo
  si se piden, con nombre `PUERTO_MODULO` para no pisar a la activa. La unidad sale de la salida del motor (la del rol).
  Los nombres se sanean (sin espacios, puntos, dos puntos ni paréntesis) y se hacen únicos sin distinguir mayúsculas
  (`GR`, `GR_2`); la profundidad reserva `DEPT` (LAS) o `DEPTH` (CSV, xlsx).
- **Nulos.** CSV y xlsx: celda vacía por defecto o un número a elección (−999,25, −9999); LAS no admite vacío y usa
  `NULL` de `~W` (−999,25 por defecto). Los lectores ya reconocen todos esos valores como «sin dato».
- **Pies.** Solo cambia la profundidad (las curvas no llevan profundidad); se redondea a 1e-6 para no escribir
  25248,999999999996. Las zonas de la hoja Zonas van en la misma unidad. STEP es 0 si el muestreo es irregular.
- **Tramo.** Rango inclusivo de profundidad (una zona usa su tope y base); sin muestras es un error en español.
- **Sumario.** No se recalcula: se toma la tabla `ZONE_SUMMARY` del resultado del motor (módulo `zone-summary`, que usa
  `petro/summary`) y los rótulos y unidades de su declaración. Va como hoja «Sumario» en Excel y como CSV aparte en un
  .zip junto a LAS o CSV (el navegador pide permiso para varias descargas seguidas). Es del pozo completo y está en las
  unidades del módulo (m), sin importar el tramo ni la unidad de profundidad elegidos.
- **Cifras sin pérdida.** Los números se escriben con la representación más corta que vuelve exacta (`String(x)`), no
  con decimales fijos.
- **Estructura para figuras.** `EXPORT_KINDS` (hoy solo `data`) y una función de armado por tipo; exportar figuras será
  otro tipo, sin tocar los escritores de datos.

## Alternativas descartadas

- **SheetJS / exceljs.** Cientos de kB y estilos, fórmulas y lectura que no usamos (ver 0002); el xlsx se arma a mano
  sobre `fflate` con cadenas en línea y un solo estilo de encabezado.
- **Convertir las curvas a otras unidades al exportar.** Fuera de alcance: cada curva sale en la unidad del pozo o del
  rol, declarada en el archivo.
- **Un archivo por zona.** Una sola descarga con el tramo elegido es lo que se pidió; varias zonas = varias exportaciones.
- **Descargar LAS y sumario como dos archivos sueltos.** Se bloquea la segunda descarga; mejor un .zip.
- **Escribir las zonas como columna de texto en CSV/xlsx.** Habría cerrado el ciclo con el lector (que las reconoce),
  pero ensancha el archivo de curvas; van en la hoja Zonas y en `~W` no hay lugar estándar.

## Pendiente

- Exportar figuras (visor, crossplot, histograma): hecho en la fase 6c-2, ver `0012-exportacion-de-figuras.md`.
- Sumario del tramo elegido (hoy es el del pozo entero) y en pies.
- Puntos de presión y plugs (conjuntos de puntos) y tendencias.
- Probado con nuestros lectores; no con Excel, LibreOffice ni programas de perfiles de terceros.
