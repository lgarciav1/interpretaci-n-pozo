# 0075 — Vistas guardadas y modo defensa

- Estado: aceptada (ficha F07 de `docs/masterplan-funciones-nuevas.md`).
- Alcance: `src/core/display.ts` (tipo y saneamiento), `src/core/state/views.ts` (recetas puras), `src/app/views/`
  (estado del modo defensa, acciones, panel «Vistas», comandos de la paleta), `src/app/App.tsx`,
  `src/app/shell/ViewerSlot.tsx`, `src/app/shell/TopBar.tsx`, `src/app/store/ui.ts`, `src/app/store/uiSync.ts`.
  Tests: `tests/views.test.ts`. Capturas: `docs/capturas/vistas/`.

## Contexto

En la defensa del TP hay que mostrar el pozo en cinco o seis encuadres preparados: el pozo entero, la zona con
hidrocarburo con la pista de Sw, el contacto del MDT, el crossplot de una capa… Hoy cada encuadre se arma a mano en
vivo (zoom, plantilla de pistas, zona, panel), con las barras de la app a la vista. La «lectura amplia» ya esconde los
laterales, pero deja la barra superior y no recuerda nada.

## Decisión

1. **Una vista es configuración del visor, no interpretación.** Vive en `Project.display.views?: SavedView[]`, junto a
   las pistas propias y las plantillas: se guarda en el archivo y en el autoguardado, entra en deshacer (guardar,
   renombrar, reordenar y borrar son recetas con `commit`), **no** está en `Interpretation`, así que no entra en
   `sameEngineInputs`, en la firma de los módulos ni en los snapshots, y no dispara cálculos. Campo opcional: un
   proyecto anterior abre igual y uno nuevo sin vistas no escribe el campo.
2. **Qué guarda una vista.**
   ```ts
   interface SavedView {
     id: string;
     name: string;            // único por pozo (sin distinguir mayúsculas); guardar con un nombre que existe la reemplaza
     wellId: string;
     workspace: string;       // espacio de trabajo
     top: number; base: number; // tramo de profundidad (m), top < base
     tracks: TrackSpec[] | null; // copia de las pistas propias del espacio al guardar; null = las de fábrica
     templateName?: string;   // plantilla aplicada al guardar (solo rótulo)
     zoneId: string | null;   // zona activa (la de los parámetros en edición)
     zoneName?: string;       // para avisar si la zona ya no existe
     panel: string | null;    // pestaña de panel a la vista, o null si no había ninguno abierto
     savedAt?: string;        // ISO 8601
   }
   ```
   El orden de la lista es el orden del recorrido; se cambia con «subir» y «bajar».
3. **Las pistas se copian, no se referencian.** Borrar o editar la plantilla con que se guardó la vista no cambia la
   vista: la defensa no se rompe por tocar plantillas después. `templateName` solo sirve de rótulo. `null` (de fábrica)
   sigue al estilo del visor del momento, como hoy.
4. **Referencias que ya no existen.** Ninguna impide abrir la vista; lo que falta se omite y se dice:
   - zona borrada → se abre sin zona activa, con «La zona X ya no existe» en el rótulo de la vista;
   - panel que ya no existe (módulo quitado) → se abre sin panel;
   - pistas con curvas que el pozo no tiene → las resuelve el visor como siempre (pistas vacías ocultas);
   - tramo fuera del pozo → el visor lo acota;
   - pozo que ya no está en el proyecto → la vista no se lista ni entra en el recorrido (el panel cuenta «N vistas de
     otros pozos»); se puede borrar.
   El saneamiento al abrir un archivo descarta solo lo que no tiene forma de vista (sin nombre, tramo inválido), con
   aviso, como las plantillas.
5. **Ir a una vista (fuera del modo defensa)** aplica a la interfaz el espacio, la zona activa, el panel y el tramo, y
   las pistas con un `commit` «Abrir vista «X»» solo si difieren de las actuales (se deshace con Ctrl+Z). Una vista
   sin panel no pliega los paneles abiertos (si no, el propio panel «Vistas» se cerraría al usarlo).
6. **El modo defensa es estado de interfaz** (`src/app/views/store.ts`), no del proyecto: no entra en el historial ni
   en el archivo.
   - Al entrar se toma una foto de la interfaz (espacio, zona en edición, paso y módulo activos, pestaña y vista del
     panel lateral, disposición, lectura amplia, panel agrandado y tramo visible del visor). Al salir se restaura tal
     cual, tramo incluido: «salir devuelve la disposición anterior».
   - Durante el modo: sin barra superior, sin barra del flujo, sin columna del pozo ni rieles. El visor ocupa la
     pantalla y, si la vista tiene panel, ese panel se muestra donde la usuaria los tenga (costado o abajo).
   - Las pistas de la vista se dibujan como **reemplazo en el visor** (`ViewerSlot` las toma del modo defensa en lugar
     de `display.layouts`), sin `commit`: recorrer no cambia el proyecto ni deja entradas para deshacer.
   - La disposición que cambia el modo no se escribe en `localStorage`.
   - Teclado: → y ← pasan de vista (sin vuelta circular: en la última, → no hace nada), Esc sale. ↑ ↓, Re Pág, Av Pág,
     + − y 0 siguen siendo del visor. Ctrl+Z y Ctrl+Y no hacen nada durante el modo (no se edita mientras se presenta).
     Por lo mismo, la paleta y los atajos de las acciones de la app se reducen al grupo «Vistas» mientras dura el modo
     (`whilePresenting` en `src/app/commands/index.ts`).
   - Indicador discreto abajo al centro: «3 / 5 · Nombre de la vista», con botones ‹ › y «Salir»; se atenúa a los
     pocos segundos sin movimiento y vuelve con el mouse o una tecla.
   - El recorrido toma las vistas del pozo activo en el orden de la lista. Sin vistas, no entra: avisa y abre el panel
     «Vistas».
   - Si cambia el pozo activo o se reemplaza el proyecto durante el modo, sale (restaurando la foto).
7. **Dónde se maneja.**
   - Panel del dock «Vistas» (`src/app/views/`): «Guardar vista actual» (pide nombre), la lista con tramo, zona,
     plantilla y panel, y por fila «Ir», «Presentar desde acá», renombrar, subir, bajar y borrar.
   - Paleta: «Guardar la vista actual…», «Modo defensa: recorrer las vistas», «Salir del modo defensa» e «Ir a la vista
     X» por vista.
   - Barra superior: botón «Modo defensa» junto a «Lectura amplia».

## Alternativas descartadas

- **Vistas en `Interpretation`.** Entrarían en los snapshots y en la comparación de interpretaciones, y harían pensar
  que cambian el resultado. Son cómo se mira, no qué se calcula.
- **Vistas en `localStorage`.** No viajarían con el archivo del proyecto: la defensa se prepara en una máquina y se
  presenta en otra.
- **Referenciar la plantilla por id.** Borrar o retocar una plantilla rompería una vista armada para la defensa sin que
  nadie se entere. La copia pesa poco (unas decenas de pistas en JSON).
- **Aplicar las pistas con `commit` al recorrer.** Cada paso del recorrido dejaría una entrada en deshacer y, al salir,
  habría que «des-aplicar»: más frágil que dibujar un reemplazo y soltarlo.
- **Pantalla completa del navegador (Fullscreen API).** Por `file://` y según el navegador pide permiso o se niega; la
  pantalla limpia dentro de la ventana anda siempre. La usuaria puede sumar F11 si quiere.
- **Animación del historial de deshacer** (descartada en el masterplan): el recorrido de vistas cuenta la
  interpretación en el orden que elige quien presenta, no en el que se trabajó.
