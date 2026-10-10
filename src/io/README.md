# src/io

Lectores Excel (.xlsx), LAS 2.0 y CSV, tabla de mnemónicos → rol y (más adelante) exportadores. Producen un `Well`
(src/core/well.ts) con `createWell`; las unidades se interpretan con `parseUnit` (src/core/units.ts). Sin React ni DOM:
corre en Node, navegador y worker. Decisiones: [docs/decisiones/0002-lectura-de-datos.md](../../docs/decisiones/0002-lectura-de-datos.md).

| Archivo | Qué hace |
|---|---|
| `index.ts` | API pública: `readWellFile`, `parseTable`, `buildWell`, `suggestMapping`, `suggestRole`, `detectFormat`, `runQc`, `unreliableMask` |
| `table.ts` | `RawTable`, interpretación de celdas, detección de encabezado y fila de unidades |
| `csv.ts` / `las.ts` / `xlsx.ts` | lectores de cada formato → `RawTable` |
| `mnemonics.ts` | mnemónico → rol y unidad por defecto, con confianza |
| `build.ts` | mapeo de columnas, profundidad a metros, zonas, curvas → `Well` |
| `pressures.ts` | tablas de presiones de formación (MDT/RFT) → conjunto de puntos `kind: 'pressure'`: reconocimiento de columnas por nombre, descripción o unidad (MD, TVD, presión, movilidad, lodo antes/después, calidad, tipo, comentario, id), conversión a m, psi y mD/cP ([0009](../../docs/decisiones/0009-presiones-mdt-y-conjuntos-de-puntos.md)) |
| `qc.ts` | control de calidad: nulos, estadísticos, picos, rango físico, rachas constantes, derrumbe; semáforo por curva ([0003](../../docs/decisiones/0003-control-de-calidad.md)) |

Presiones: `parseTable(bytes, nombre, { requireDepth: false })` → `suggestPressureMapping(tabla)` editable →
`buildPressureSet(tabla, mapeo, { id, name })` (ver `src/modules/mdt/LoadPressuresDialog.tsx`). Con
`requireDepth: false` la tabla no necesita que la primera columna sea la profundidad (las pruebas suelen empezar por
su id).

Uso desde la interfaz: `parseTable(bytes, nombre)` → mostrar `suggestMapping(tabla)` editable → `buildWell(tabla, mapeo)` →
`runQc(pozo)` (ver `src/app/components/LoadWellDialog.tsx`).
