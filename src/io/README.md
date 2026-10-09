# src/io

Lectores Excel (.xlsx), LAS 2.0 y CSV, tabla de mnemónicos → rol y (más adelante) exportadores. Producen un `Well`
(src/core/well.ts) con `createWell`; las unidades se interpretan con `parseUnit` (src/core/units.ts). Sin React ni DOM:
corre en Node, navegador y worker. Decisiones: [docs/decisiones/0002-lectura-de-datos.md](../../docs/decisiones/0002-lectura-de-datos.md).

| Archivo | Qué hace |
|---|---|
| `index.ts` | API pública: `readWellFile`, `parseTable`, `buildWell`, `suggestMapping`, `suggestRole`, `detectFormat` |
| `table.ts` | `RawTable`, interpretación de celdas, detección de encabezado y fila de unidades |
| `csv.ts` / `las.ts` / `xlsx.ts` | lectores de cada formato → `RawTable` |
| `mnemonics.ts` | mnemónico → rol y unidad por defecto, con confianza |
| `build.ts` | mapeo de columnas, profundidad a metros, zonas, curvas → `Well` |

Uso desde la interfaz: `parseTable(bytes, nombre)` → mostrar `suggestMapping(tabla)` editable → `buildWell(tabla, mapeo)`.
