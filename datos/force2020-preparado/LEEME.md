# Dataset FORCE 2020 preparado (entrenamiento del clasificador de litologías)

Subconjunto compacto y limpio de los datos de entrenamiento de la competencia FORCE 2020, listo para entrenar el random forest de litología de la fase 10b. **No es una interpretación del pozo del TP**: son perfiles de 98 pozos del Mar del Norte con etiquetas de litología hechas por geólogos. Decisión y números de comparabilidad: `docs/decisiones/0030-datos-force2020.md`.

## Origen, licencia y cita

- Datos: *FORCE 2020 Machine Learning Competition, lithology prediction* (`train.csv`, 98 pozos, 1.170.511 filas). Publicados por la Norwegian Petroleum Directorate / FORCE.
- Cita (de `CITATION.cff` y `readme.md` de la rama `force2020`): Bormann P., Aursand P., Dilib F., Dischington P., Manral S. (2020). *FORCE Machine Learning Competition*. https://github.com/bolgebrygg/Force-2020-Machine-Learning-competition — DOI https://doi.org/10.5281/zenodo.4351156 (Zenodo 4351156).
- Licencia: **NOLD 2.0** (Norwegian License for Open Government Data) según el encargo. **No se pudo verificar**: la rama `force2020` no trae un archivo de licencia del dataset (`CITATION.cff` y el `readme.md` solo dan la cita y el DOI) y Zenodo no era accesible desde el entorno de trabajo. Confirmarlo en https://doi.org/10.5281/zenodo.4351156 antes de entregar. NOLD 2.0 exige citar la fuente.
- Crudo: está en la rama `force2020` del repo (`datos/FORCE2020/`) o en Zenodo. El crudo NO forma parte de este directorio ni de `src/`; aquí solo está el derivado.

## Archivos

| Archivo | Contenido |
|---|---|
| `force2020.csv.gz` | Datos (CSV con coma, gzip, encabezado en la primera fila, celda vacía = sin dato). |
| `manifest.json` | Orden de columnas, mapeo de mnemónicos, clases, filtros, recuentos por clase y por pozo, percentiles de GR por pozo, semilla, versión del guion y SHA-256 del CSV sin comprimir. |

Leer desde Node (sin dependencias):

```js
import fs from 'node:fs';
import zlib from 'node:zlib';
const text = zlib.gunzipSync(fs.readFileSync('datos/force2020-preparado/force2020.csv.gz')).toString('utf8');
const [header, ...lines] = text.trim().split('\n');
```

## Columnas

`WELL, DEPTH_MD, GR, RHOB, NPHI, PEF, DT, RT, RM, LITHO, CONFIDENCE`

| Columna | Origen FORCE | Equivalente en el pozo del TP | Unidad |
|---|---|---|---|
| WELL | WELL | (un solo pozo) | texto |
| DEPTH_MD | DEPTH_MD | DEPTH | m |
| GR | GR | GR | gAPI |
| RHOB | RHOB | ZDEN | g/cm³ |
| NPHI | NPHI | NPHI | v/v |
| PEF | PEF | PE (**sospechoso en el TP**, ver decisión 0029) | b/e |
| DT | DTC | DT | µs/ft |
| RT | RDEP | AT90 | ohm·m |
| RM | RMED | AT30 (alternativa: AT60) | ohm·m |
| LITHO | FORCE_2020_LITHOFACIES_LITHOLOGY, agrupada | — | id de clase (0–8) |
| CONFIDENCE | FORCE_2020_LITHOFACIES_CONFIDENCE | — | 1 = alta, 2 = media, 3 = baja |

Los nombres son los roles canónicos de `src/core/roles.ts` y `src/io/mnemonics.ts`. Valores crudos, sin transformar: resistividades en lineal y GR sin normalizar. `PEF` queda vacío en las filas donde FORCE no lo tiene (36 % de las filas completas del resto de curvas; 38 % del archivo submuestreado). Hay 25 filas con `CONFIDENCE` vacía.

## Clases (tabla editable en el guion: `CLASS_GROUPS`)

| id | Clase | Códigos FORCE | Filas completas | Filas conservadas | Pozos |
|---|---|---|---|---|---|
| 0 | SANDSTONE | 30000 Sandstone | 102.777 | 51.388 | 96 |
| 1 | SANDSTONE_SHALE | 65030 Sandstone/Shale | 83.491 | 41.748 | 93 |
| 2 | SHALE | 65000 Shale | 378.577 | 54.086 | 96 |
| 3 | MARL | 80000 Marl | 22.848 | 22.848 | 62 |
| 4 | CARBONATE | 70000 Limestone, 70032 Chalk, 74000 Dolomite | 42.440 | 42.440 | 92 |
| 5 | EVAPORITE | 88000 Halite, 86000 Anhydrite | 290 | 290 | 3 |
| 6 | COAL | 90000 Coal | 2.504 | 2.504 | 48 |
| 7 | TUFF | 99000 Tuff | 6.759 | 6.759 | 29 |
| 8 | BASEMENT | 93000 Basement | 90 | 90 | 1 |

«Filas completas» = filas que pasan todos los filtros (antes de submuestrear). EVAPORITE (3 pozos) y BASEMENT (1 pozo) no se pueden validar con validación cruzada por pozos.

## Filtros aplicados

Embudo sobre las 1.170.511 filas (en este orden; lo que ve cada fila es el primer motivo que la descarta):

1. Falta alguna curva exigida (GR, RHOB, NPHI, DT, RT, RM): 465.111.
2. Fuera de rango físico (`validRange` del manifest, p. ej. RHOB 1,0–3,2 g/cm³, NPHI −0,15–1,0, DT 30–300 µs/ft, resistividad 0,01–10.000 ohm·m): 147. PEF fuera de 0,5–100 b/e no descarta la fila, deja la celda vacía (842).
3. Derrumbe: CALI > calibre + 2 in: 63.990. CALI inválido: CALI < calibre − 2 in: 1.487. El calibre es el BS de la fila; si falta, el BS válido más cercano del mismo pozo; si el pozo no tiene BS (29 pozos), el percentil 10 del CALI en bloques de 500 muestras. Una fila sin CALI se conserva.
4. Quedan **639.776 filas completas** (sin exigir PEF) de 98 pozos; 407.117 con PEF (67 pozos con ≥ 500 filas).

Submuestreo: ver `manifest.json > sampling`. Las clases con más de 60.000 filas completas se adelgazan con un paso fijo (1 de cada k, k = 2 para SANDSTONE y SANDSTONE_SHALE, 7 para SHALE) siguiendo la profundidad de cada pozo; las demás se conservan enteras. Resultado: **222.153 filas, 4,4 MB**. Los datos están ordenados por pozo y profundidad.

## Cómo reproducir

Requisitos: Node ≥ 20 y `npm ci` (solo `fflate`, para leer el .zip).

1. Obtener `train.zip` (o `train.csv`) de Zenodo 4351156 o de la rama `force2020` del repo.
2. `node scripts/ml/preparar-force2020.mjs <ruta/train.zip|train.csv> datos/force2020-preparado` (≈ 1 min, memoria acotada a un pozo por vez). Misma entrada, semilla (2020) y versión del guion dan el mismo archivo byte a byte (comparar `dataSha256`).
3. `node scripts/ml/analizar-force2020.mjs <ruta/train.zip|train.csv>` imprime el informe de comparabilidad FORCE ↔ TP (percentiles, cobertura, resistividades, normalización del GR) en JSON.

Para cambiar la agrupación, los filtros o el tope por clase se edita la configuración al principio del guion (`CLASS_GROUPS`, `VALID_RANGE`, `CALIPER`, `SAMPLING`) y se vuelve a correr.
