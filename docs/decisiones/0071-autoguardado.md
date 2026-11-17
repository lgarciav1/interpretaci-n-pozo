# 0071 — Autoguardado y «Seguir donde quedaste»

- Estado: aceptada (ficha F01 de `docs/masterplan-funciones-nuevas.md`).
- Alcance: `src/app/autosave/` (nuevo), `src/app/projectFiles/`, `src/app/shell/projectActions.ts`,
  `src/app/shell/TopBar.tsx`, `src/app/home/HomeScreen.tsx`, `src/app/main.tsx`. Capturas: `docs/capturas/autoguardado/`.

## Contexto

Recargar la pestaña perdía todo: el proyecto vive solo en memoria y se salva a mano con «Guardar proyecto» (descarga un
`.pozo.json`). `localStorage` guarda solo preferencias (tema, tamaño, disposición). El proyecto del TP interpretado pesa
varios MB serializado, y la app se entrega como un único HTML que se abre por `file://`.

## Decisión

1. **IndexedDB, no `localStorage`.** `localStorage` tiene un cupo típico de 5 MB por origen, es síncrono (traba el hilo
   principal al escribir) y solo guarda texto UTF-16 (el doble de bytes). IndexedDB es asíncrono y su cupo es una
   fracción del disco.
   - Base `fiubalog-autoguardado`, versión 1, dos almacenes: `sesiones` (metadatos chicos: id, nombre del proyecto,
     pozos, fecha, tamaño, versión del esquema) y `datos` (el texto del proyecto). Inicio lista los metadatos sin leer
     los MB del proyecto.
2. **Mismo formato que el archivo.** El texto guardado es exactamente lo que devuelve `serializeProject` (v6 o v7): un
   autoguardado se lee con `deserializeProject`, igual que un `.pozo.json`, y si falla y es v7 se intenta
   `recoverProject`. No hay formato nuevo ni migración aparte: un autoguardado viejo se migra como un archivo viejo.
3. **Fuera del hilo principal.** Serializa el worker de archivos (`runProjectFileTask`, tarea `save`) con un cliente
   propio del autoguardado, así no choca con «Guardar proyecto» ni «Abrir proyecto». Abrir la sesión usa la tarea
   `open` (y una nueva tarea `recover`) en el mismo worker.
4. **Cuándo se guarda.** 3 s después del último cambio del proyecto (cada cambio reinicia la espera); si se está
   arrastrando algo en el visor o hay otro guardado en curso, se espera a que termine. No se guarda un proyecto sin
   pozos. Si el proyecto cambió mientras se serializaba, se programa otra vuelta.
   - **La demostración no se autoguarda.** Un proyecto cuyos pozos son todos el de demostración (`DEMO_WELL_ID`) se
     rehace en un clic: guardarlo desplazaría sesiones reales del cupo de 3 (punto 5). Tampoco pide confirmación al
     cerrar. Si se le agrega otro pozo, vuelve a guardarse.
   - **Un proyecto abierto desde un archivo también se autoguarda**, aunque ya esté en el `.pozo.json`: así aparece en
     «Seguir donde quedaste» después de recargar.
   - **Si la escritura falla** (cupo lleno, base cerrada): se reintenta a los 3 s, 15 s y 60 s, y después se espera al
     próximo cambio del proyecto. Se avisa con un toast una sola vez por racha de fallos y la barra muestra el error
     (punto 8). Un guardado bueno termina la racha.
5. **Cuántas copias: la última por sesión de trabajo, hasta 3 sesiones.** Una sesión de trabajo empieza al abrir un
   proyecto o al hacer el primer cambio sobre un proyecto vacío, y continúa al recuperarla. Cada guardado reemplaza la
   copia de su sesión. Después de escribir se borran las sesiones más viejas que la tercera. Inicio ofrece la más
   reciente como «Seguir donde quedaste» y las otras dos debajo; cada una se puede descartar a mano.
6. **Recuperar.** Inicio (con el proyecto vacío, o sea al arrancar) muestra «Seguir donde quedaste» con el nombre, los
   pozos y hace cuánto se guardó. Recuperar reemplaza el proyecto (historial de deshacer vacío) y continúa en la misma
   sesión de trabajo. No se recupera solo al arrancar: la usuaria elige (puede querer empezar de cero).
   - Si el proyecto se llama «Proyecto sin nombre» (el nombre por defecto), el título de la sesión son sus pozos
     («Pozo TP», «Pozo TP y 1 más») y el detalle no los repite; con nombre propio, el título es el nombre.
   - **Después de recuperar queda Inicio**, con el pozo ya cargado y «Entrar al pozo» con el foco: la entrada al pozo es
     la de siempre y la sarta 3D muestra la del pozo recuperado (confirma qué se recuperó).
   - Antes de abrir, se espera la escritura en curso del autoguardado (el worker hace una tarea a la vez).
   - **Lo recuperado en parte no cuenta como a salvo:** si el v7 solo se recuperó con `recoverProject`, la copia
     guardada sigue dañada; el proyecto se reescribe a los 3 s y hasta entonces cuenta como cambio sin guardar.
7. **Un autoguardado roto no impide arrancar.** Leer la base, los metadatos o el texto nunca tira abajo la app: un
   metadato inválido o de otro esquema se ignora y se borra; un texto que no abre ni se recupera avisa con un toast y
   se borra. Un proyecto de una versión más nueva de la app tampoco abre: se avisa y se conserva (se puede descartar).
   - **Qué borra y qué conserva.** Solo un error del contenido borra la sesión: datos ausentes, texto que no es JSON o
     no es un proyecto, un v7 dañado que tampoco se recupera. Un error de infraestructura (worker ocupado, caído o
     que tarda demasiado, respuesta mal formada, base que no devuelve los datos) avisa y la conserva: no dice nada del
     texto. El cliente de archivos los distingue (`ProjectFileContentError` para lo que tiró la tarea misma).
   - **La versión más nueva se decide antes de abrir**, con la versión de los metadatos o de la cabecera del texto
     contra la más nueva que la app sabe leer (`PROJECT_VERSION`, `REVISION_PROJECT_VERSION`): no se llama al worker.
     El mensaje del lector («versión más nueva») queda solo como respaldo.
8. **Estado en la barra superior.** «Guardado hace N s» (actualizado cada pocos segundos), «Guardando…», «Cambios sin
   guardar», «Autoguardado falló» (con el motivo en el tooltip y los reintentos del punto 4) o «Sin autoguardado» (el
   navegador niega IndexedDB). Con solo la demostración dice «Demostración» (no se autoguarda). El estado cuenta tanto el autoguardado como el
   archivo: el proyecto está a salvo si es el mismo objeto que se guardó en el navegador o en el último `.pozo.json`
   (o el que se abrió). Comparar por referencia alcanza porque el store es inmutable; deshacer hasta lo guardado vuelve
   a contar como guardado.
   - **El proyecto del arranque cuenta como a salvo**: el vacío o la demostración de `?inicio=no` se rehacen solos. La
     barra dice «Sin cambios» y la sesión de trabajo empieza con el primer cambio.
9. **Aviso al cerrar.** `beforeunload` pide confirmación si hay pozos y el proyecto no está ni en el archivo ni en el
   autoguardado (los 3 s de espera, o un navegador sin IndexedDB).
10. **Si el navegador niega IndexedDB** (Firefox en ventana privada, políticas de la organización, `file://` en algún
    navegador): la app funciona igual, la barra dice «Sin autoguardado» y el aviso al cerrar queda como única red.

## Prueba por `file://`

| Navegador | Resultado |
|---|---|
| Chromium (Playwright, 2026-11-17) | Funciona: `dist/index.html` por `file://` escribe y lee 5 MB, y la sesión se recupera tras recargar. Todos los archivos `file://` comparten un mismo origen. |
| Edge | **Sin probar** (no hay Edge en el entorno). Es Chromium: se espera lo mismo. |
| Firefox | **Sin probar** (no hay Firefox en el entorno). Firefox da a cada archivo `file://` un origen propio; si niega IndexedDB, rige el punto 10. |

Riesgo aceptado: en Chromium todas las copias del HTML abiertas por `file://` comparten la base. Dos versiones distintas
de la app comparten sesiones; una más vieja no abre las de una más nueva (punto 7). Con varias pestañas o copias del
HTML abiertas a la vez, la poda a 3 sesiones es global: el guardado de una pestaña puede borrar la sesión de otra (la
que la usa sigue trabajando y la vuelve a crear en su próximo guardado, pero si se cerró, se pierde). La copia duradera
sigue siendo el `.pozo.json`.

## Alternativas descartadas

- **`localStorage`:** cupo chico, síncrono, texto UTF-16 (punto 1).
- **Recuperar automáticamente al arrancar:** decide por la usuaria y, si el autoguardado está roto, el arranque depende
  de él.
- **Varias versiones por proyecto (historial):** los snapshots ya cubren volver a un estado anterior; multiplica el
  espacio usado sin ganar nada.
- **Una sola copia global:** ver la demostración pisaría el pozo del TP interpretado.
- **Serializar en el hilo principal con espera ociosa:** comprimir el TP lleva decenas de ms; el worker ya existe.
- **File System Access API (guardar sobre el `.pozo.json`):** no existe en Firefox y pide permiso en cada sesión.
