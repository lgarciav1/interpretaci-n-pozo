# 0074 — «¿De dónde sale este número?»: la cadena de una muestra

- Estado: aceptada (ficha F03 de `docs/masterplan-funciones-nuevas.md`).
- Alcance: `src/core/engine/engine.ts` (lo que publica cada corrida), `src/core/engine/provenance.ts` (recorrido puro,
  nuevo), un panel del dock «Origen», el menú contextual del visor (`src/viewer/WellViewer.tsx`) y `openEquations`.
  Tests: `tests/provenance.test.ts`. Capturas: `docs/capturas/origen/`.

## Contexto

En la defensa del TP la pregunta típica es «¿de dónde sale este Sw?». Hoy la respuesta exige abrir paso por paso:
qué fuente alimenta cada puerto, qué parámetros tiene la zona y qué valor tenía cada curva intermedia en esa
profundidad. El motor ya sabe todo eso en cada corrida (plan del grafo, entradas usadas, parámetros resueltos por
zona), pero solo publica las salidas, las fuentes elegidas y un reporte por nodo sin entradas ni parámetros.

## Decisión

1. **No se recalcula nada.** El panel solo lee lo que publicó la última corrida del motor (`useResults`). Los valores
   de cada eslabón son las salidas ya publicadas, leídas en el índice de la muestra. Así los números coinciden por
   construcción con las curvas del visor.
2. **El motor publica lo que usó, no lo que planeó.** `NodeReport` suma dos campos opcionales, solo para los nodos que
   corrieron bien (`status: 'ok'`):
   - `inputs: Record<clave, SourceRef | null>`: la fuente que recibió cada entrada en esa corrida, después de soltar
     las opcionales cuyo módulo falló (`null` = ausente). Rehacer `planGraph` en el hilo principal se descarta: no ve
     lo que se suelta en tiempo de ejecución y podría mostrar una cadena que no fue.
   - `params: { global: ParamValues; byZone: Record<zonaId, ParamValues> }`: los valores resueltos que recibió
     `compute`. Leerlos de `interpretation.params` se descarta: durante un recálculo en vuelo el panel mostraría
     parámetros de una corrida y valores de otra, y el chequeo «reemplazar en la ecuación da el resultado» fallaría.

   `EngineRunResult` suma `segments: { start; end; zoneId }[]` (los tramos de `layoutZones` que vio el motor), para
   saber qué zona —y por lo tanto qué parámetros— aplicaron a la muestra. Todo es JSON chico (módulos × zonas ×
   parámetros) y viaja por el protocolo del worker sin cambios en el cliente.
3. **Recorrido puro y genérico.** `traceSample(result, registry, curves, index, outputKey)` en
   `src/core/engine/provenance.ts` arma la traza recorriendo `nodes[].inputs` hacia arriba desde el módulo de la
   salida elegida, sin código por módulo. Devuelve los eslabones en el orden del motor (de las curvas medidas hacia
   la salida: GR → IGR → Vsh → φ → Rw → Sw). Un módulo que alimenta a varios (Vsh entra en φ y en Sw) aparece una sola
   vez y los demás lo citan por referencia: la traza es el grafo, no un árbol con repeticiones.
4. **Cada eslabón muestra:** nombre y categoría del módulo; el valor de cada salida en la muestra (con unidad, la que
   sigue la cadena resaltada); cada entrada con su rótulo, su fuente y su valor; los parámetros de la zona de la
   muestra con rótulo, valor y unidad, marcando cuáles son propios de la zona y cuáles globales; y el enlace
   «Ver en Ecuaciones» (`openEquations(moduleId)`).
5. **Qué se muestra en cada caso de entrada:**
   - **Curva medida:** es una hoja. Mnemónico, «medida», y el valor en la unidad canónica del rol (la que recibió el
     módulo; si la unidad es desconocida, el valor crudo con la advertencia). Una curva **preparada** se marca
     «preparada» y su valor sale del paquete preparado de la corrida; la receta de preparación no se despliega acá.
   - **Curva con otro rol elegida a mano** (p. ej. AT60 como RT): «medida · elegida para <puerto>».
   - **Escalar / valor por zona:** el número (el de la zona de la muestra). **Tabla:** «tabla de N filas», sin abrir.
   - **Entrada opcional ausente:** «sin dato (opcional)»; si la ausencia viene de un módulo que falló, se dice cuál.
   - **Fuente distinta de la elegida para ese puerto** (el módulo es la fuente elegida de su propio puerto y toma la
     siguiente candidata): se marca «usa <fuente> (la elegida es este mismo módulo)».
   - **Otras candidatas** del puerto se listan por nombre como «otras fuentes disponibles», sin valores (no corrieron
     o no alimentan la cadena; si una está en comparación se marca «alternativa»).
   - **Dato faltante en la muestra (NaN):** se muestra «—» y la traza señala el primer eslabón donde aparece el hueco
     (todas sus entradas tienen valor y su salida no): ahí se corta la cadena.
   - **Salida elegida que es una alternativa** (módulo en comparación, no alimenta la cadena): la traza se arma igual
     y el encabezado lo dice: «alternativa: no alimenta la cadena».
   - **Curva medida elegida en el visor:** no hay cadena; el panel dice que es un dato medido.
6. **Dónde vive.** Un panel del dock «Origen» (`id: 'provenance'`), descubierto como los demás. Se abre desde el menú
   contextual del perfil con «¿De dónde sale este número?» cuando la curva más cercana es calculada (deshabilitado con
   explicación si es medida o no hay curva). La selección `{ outputKey, depth }` vive en un store de UI que no se
   guarda en el proyecto. El panel se suscribe a `useResults`: mover un parámetro recalcula el motor y el panel se
   actualiza solo. Dentro del panel se puede cambiar la salida (selector con las curvas calculadas) y moverse una
   muestra arriba o abajo.
7. **Las ecuaciones no se muestran en el panel** (regla del proyecto): solo valores, fuentes y parámetros, con el
   enlace a la entrada de Ecuaciones.

## Alternativas descartadas

- **Recalcular la cadena en la muestra** (correr cada `compute` con un pozo de una muestra). Duplicaría el motor y
  rompe con los módulos que usan ventanas, estadísticas por zona o tablas del pozo entero (Rwa, normalizaciones).
- **Ficha a mano por módulo** («Sw sale de Rt, Rw, φ…»). Viola «funciona para cualquier curva calculada sin código por
  módulo» y envejece con cada módulo nuevo.
- **Árbol con repeticiones.** Vsh aparecería dos veces en la cadena de Sw (vía φ efectiva y directo); con más módulos
  el árbol explota. La lista en orden del motor con referencias se lee como la cadena del libro.
- **Popover sobre el visor.** No tiene lugar para cinco o seis eslabones con parámetros y tapa el perfil que se está
  explicando; el dock deja ver las dos cosas.
