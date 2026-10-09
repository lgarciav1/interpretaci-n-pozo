# 0002 — Lectura de datos (CSV, LAS 2.0, xlsx)

- Estado: aceptada (fase 2a)
- Alcance: `src/io/`.

## Decisiones

- **Dos etapas.** `parseTable` lee el archivo a una `RawTable` (columnas con nombre, unidad en texto y datos, sin roles);
  `buildWell(tabla, mapeo, opciones)` aplica el mapeo de columnas y arma el `Well` con `createWell`. La interfaz puede
  mostrar el mapeo sugerido (`suggestMapping`) en un asistente editable entre las dos. `readWellFile` hace ambas.
- **xlsx: parser mínimo propio sobre `fflate` 0.8.3** (sin dependencias; con tree-shaking solo entran `unzipSync` y `strFromU8`),
  leyendo `workbook.xml`, `sharedStrings.xml` y la hoja. `SheetJS`/`exceljs` pesan cientos de kB, traen mucho que no
  usamos (fórmulas, estilos, escritura) y complican el HTML único; acá solo hacen falta los valores de las celdas.
  Sin `DOMParser`, para que corra igual en Node (tests) y en un worker.
- **Zonas.** Una columna de texto llamada ZONA/ZONE/FORMACION... no es una curva: se convierte a `Zone[]` (tope = primera
  profundidad de la zona, base = última). Otras columnas de texto se descartan con aviso.
- **Profundidad.** Siempre a metros (`sourceUnit` guarda la original). Filas sin profundidad se descartan con aviso;
  decreciente de punta a punta se invierte; duplicada o no creciente es un error con el número de fila del archivo.
- **Nulos.** Celda vacía, `NULL`, `NaN`, `N/A`, `-999.25`, `-999`, `-9999` y `-99999` → NaN (CSV/xlsx). En LAS, el `NULL` de `~W`.
- **Alias de unidades.** `src/core/units.ts` guarda alias como `'µS/FT'` pero busca en mayúsculas (`'µs/ft'` → `'ΜS/FT'`,
  con mu griega), así que `µs/ft` no se reconocía. `io/mnemonics.ts` registra las grafías con µ (U+00B5) y μ (U+03BC).
