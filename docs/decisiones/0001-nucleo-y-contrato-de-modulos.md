# 0001 — Núcleo: modelo de datos, contrato de módulos, grafo de cálculo y estado

- Estado: aceptada (fase 1)
- Alcance: todo lo que heredan las fases siguientes (lectores, visor, petrofísica, módulos, gráficos, Monte Carlo, snapshots).

## Contexto

La app corre 100 % en el navegador y se entrega como un único HTML. Tiene que recalcular en vivo una cadena
Vsh → φ → Sw → k → cutoffs → sumario mientras se mueve un slider, con pozos de decenas de miles de muestras,
permitir varios métodos por paso, parámetros por zona, salidas que no son curvas, snapshots y Monte Carlo sin UI.
Agregar un módulo tiene que ser una carpeta y una línea de registro.

## Decisiones

### D1. Los módulos se encadenan por **puertos** (roles), no por referencias a otros módulos

Un módulo declara qué consume (`inputs`: curvas por rol, escalares por id) y qué produce (`outputs`: curvas por
rol, escalares y tablas por id). El grafo se arma solo: para cada puerto se elige **una fuente**, y el módulo que
consume ese puerto depende de esa fuente.

- Alternativa descartada: que cada módulo nombre a sus proveedores (`dependsOn: ['vsh-larionov']`). Acopla módulos
  entre sí; agregar un método nuevo obliga a editar a sus consumidores.
- Alternativa descartada: un único "pipeline" fijo en el núcleo. Contradice la extensibilidad.

### D2. Varios métodos por paso = varios módulos que producen el mismo puerto

`vsh-linear`, `vsh-larionov`, `vsh-clavier` producen todos `VSH`. El estado de interpretación guarda
`sources[puerto]` (curva medida o módulo). Regla por defecto, determinística: curva medida con ese rol → primer
módulo registrado. Los módulos listados en `compare` se calculan también, con las mismas entradas que la cadena
elegida, pero sus salidas **no alimentan** aguas abajo: sirven para ver alternativas lado a lado.

- Un módulo nunca consume su propia salida: si es la fuente elegida de un puerto que también consume, toma la
  siguiente fuente. Eso habilita correcciones (p. ej. "RT corregida" que lee RT medida y produce RT).
- Alternativa descartada: un módulo por paso con un parámetro `method` (enum). Agregar un método obligaría a editar
  el módulo, y los esquemas de parámetros de métodos distintos se mezclarían.
- Los parámetros comunes a varios métodos (Rw, a, m, n) se declaran `shared: true` y se guardan una sola vez; el
  registro verifica que todas las declaraciones de un parámetro compartido sean compatibles.

### D3. Parámetros: esquema declarativo, valor global + override por zona, resueltos por segmentos

Cada parámetro declara tipo (`number` con min/max/step/unidad/escala lineal-log, `enum`, `boolean`), etiqueta y
tooltip en español, y `scope: 'global' | 'zone'`. El estado guarda `params.global[clave]` y
`params.zones[zoneId][clave]`; lo ausente toma el default. El motor parte el pozo en **segmentos contiguos de
muestras con la misma zona** y le pasa al módulo, por segmento, los parámetros ya resueltos. Las funciones de
`src/petro/` reciben escalares y rangos `[start, end)`: no saben de zonas.

- Alternativa descartada: pasar un array por muestra para cada parámetro. Más memoria y obliga a todas las
  funciones de petro a aceptar "número o array".

### D4. Salidas no-curva de primera clase

`outputs` admite `curve` (Float64Array de largo n), `scalar` (number) y `table` (filas JSON). Los escalares pueden
ser entrada de otros módulos (p. ej. Rw de un módulo Pickett). Las tablas por zona (sumario) son tablas.

### D5. Definición pura separada de la UI

`src/modules/<id>/index.ts` exporta la definición pura (sin React, sin DOM): es lo único que importa el worker.
El panel a medida, si existe, va en `src/modules/<id>/panel.tsx` y la app lo descubre por convención
(`import.meta.glob`). Sin panel, la UI genera los controles a partir del esquema. Un test verifica que ninguna
definición, ni `core`, ni `petro`, importe React.

### D6. Motor incremental, igual en proceso y en worker

`Engine` (en `src/core/engine/`) es una clase sin dependencias de navegador. Cada nodo tiene una **firma de
entrada**: parámetros resueltos que lo afectan + zonas (geometría y nombre; no el color) + versión de cada entrada (revisión de la curva
medida o versión de la salida del módulo proveedor). Si la firma no cambió, reusa el resultado; si cambió, recalcula
e incrementa la versión de sus salidas, lo que invalida solo a sus dependientes. Tests y Monte Carlo usan `Engine`
directo; la app lo usa a través de un worker con el mismo protocolo (`serveEngine` / `EngineClient`), que también
tiene un transporte en proceso para cuando no hay worker.

- Los datos medidos se mandan al worker una vez (`syncWell` solo reenvía arrays nuevos, por identidad).
- El worker responde solo los datos de salidas que cambiaron desde la última respuesta, como transferibles.
- Coalescencia en el cliente: a lo sumo un cálculo en vuelo y uno pendiente; el pendiente se reemplaza (gana el
  último). Las respuestas llevan `seq` y `gen` (generación de pozo) para descartar resultados viejos.
- Regla: los arrays de datos son inmutables por convención; editar una curva = reemplazar su array.

### D7. Workers dentro del HTML único

`import EngineWorker from './engine.worker?worker&inline'` con `worker.format = 'iife'`: Vite empaqueta el worker
aparte y lo incrusta en base64; en ejecución se crea desde un Blob URL (worker clásico, sin fetch). Verificado en
Chromium por `file://`. Si la creación falla, la app cae al transporte en proceso (misma API, sin paralelismo).

### D8. Estado en tres capas

1. **Proyecto** (serializable): pozos (datos medidos), interpretación por pozo (zonas, parámetros, fuentes,
   comparaciones, módulos desactivados) y snapshots. Se modifica solo con funciones puras
   `(proyecto, ...) => proyecto` de `src/core/state/`, lo que deja listo deshacer/rehacer (historial de proyectos
   inmutables con estructura compartida; los arrays no se copian).
2. **UI** (no se guarda): espacio de trabajo, módulo activo, zona en edición.
3. **Resultados** (derivados, no se guardan): lo que devuelve el motor.

Herramienta: `zustand` (≈1 kB) solo en `src/app/`; el núcleo no depende de ella. Se eligió sobre Redux (más
ceremonia) y sobre Context de React (re-render de todo el árbol en cada movimiento de slider; zustand permite
selectores y suscribirse fuera de React, que es lo que necesita el puente con el worker).

### D9. Formato de proyecto

JSON con `format`/`version` y migraciones. Las curvas van como `Float64` little-endian, con "byte shuffle" +
deflate (`CompressionStream`, nativo del navegador) + base64: exacto (roundtrip bit a bit, NaN incluido) y compacto.
Si `CompressionStream` no existe, se usa la variante sin compresión.

## Consecuencias

- Agregar un método nuevo no toca a nadie: el selector de método lo ofrece porque produce un puerto existente.
- El motor no sabe nada de módulos concretos; la composición (registro + worker) vive en `src/modules/index.ts` y
  `src/app/`.
- Abierto: cancelar un cálculo largo a mitad de camino (hoy se coalesce entre cálculos, no dentro de uno);
  enlazar un parámetro a un escalar calculado (hoy un escalar puede ser entrada, no valor de un slider).

## Revisión (fase 1, después de la revisión independiente)

- **Inmutabilidad de entradas:** tipo propio `ReadonlyCurve` (sin métodos que mutan, `subarray` de solo lectura) y
  modo `checkInputs` del motor que hashea las entradas antes y después de `compute`. El tipo protege en
  compilación salvo casts; el modo de verificación lo detecta en ejecución (tests y desarrollo).
- **Parámetros compartidos:** catálogo canónico `src/modules/sharedParams.ts`, comparación de todos los campos y
  aviso si una clave es compartida en un módulo y propia en otro.
- **Categorías extensibles:** un módulo puede declarar una categoría nueva (`category` + `categoryLabel`) sin
  tocar el núcleo; las conocidas solo fijan orden y etiqueta.
- **Contexto de cálculo:** `ctx.paramsFor(zoneId)` para cálculos por zona.
- **Fuente explícita con otro rol:** permitida si es la misma magnitud, con diagnóstico `info`.
- **Supervisor del motor:** recrea el worker o pasa al motor en proceso ante cualquier error, reenviando pozo y
  último pedido; los resultados llevan `wellId` y `gen`, y al cambiar de pozo se borran.
