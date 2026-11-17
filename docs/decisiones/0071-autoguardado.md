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
5. **Cuántas copias: la última por sesión de trabajo, hasta 3 sesiones.** Una sesión de trabajo empieza al abrir un
   proyecto o al hacer el primer cambio sobre un proyecto vacío, y continúa al recuperarla. Cada guardado reemplaza la
   copia de su sesión. Después de escribir se borran las sesiones más viejas que la tercera. Inicio ofrece la más
   reciente como «Seguir donde quedaste» y las otras dos debajo; cada una se puede descartar a mano.
6. **Recuperar.** Inicio (con el proyecto vacío, o sea al arrancar) muestra «Seguir donde quedaste» con el nombre, los
   pozos y hace cuánto se guardó. Recuperar reemplaza el proyecto (historial de deshacer vacío) y continúa en la misma
   sesión de trabajo. No se recupera solo al arrancar: la usuaria elige (puede querer empezar de cero).
7. **Un autoguardado roto no impide arrancar.** Leer la base, los metadatos o el texto nunca tira abajo la app: un
   metadato inválido o de otro esquema se ignora y se borra; un texto que no abre ni se recupera avisa con un toast y
   se borra. Un proyecto de una versión más nueva de la app tampoco abre: se avisa y se conserva (se puede descartar).
8. **Estado en la barra superior.** «Guardado hace N s» (actualizado cada pocos segundos), «Guardando…», «Cambios sin
   guardar» o «Sin autoguardado» (el navegador niega IndexedDB). El estado cuenta tanto el autoguardado como el
   archivo: el proyecto está a salvo si es el mismo objeto que se guardó en el navegador o en el último `.pozo.json`
   (o el que se abrió). Comparar por referencia alcanza porque el store es inmutable; deshacer hasta lo guardado vuelve
   a contar como guardado.
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
de la app comparten sesiones; una más vieja no abre las de una más nueva (punto 7). La copia duradera sigue siendo el
`.pozo.json`.

## Alternativas descartadas

- **`localStorage`:** cupo chico, síncrono, texto UTF-16 (punto 1).
- **Recuperar automáticamente al arrancar:** decide por la usuaria y, si el autoguardado está roto, el arranque depende
  de él.
- **Varias versiones por proyecto (historial):** los snapshots ya cubren volver a un estado anterior; multiplica el
  espacio usado sin ganar nada.
- **Una sola copia global:** ver la demostración pisaría el pozo del TP interpretado.
- **Serializar en el hilo principal con espera ociosa:** comprimir el TP lleva decenas de ms; el worker ya existe.
- **File System Access API (guardar sobre el `.pozo.json`):** no existe en Firefox y pide permiso en cada sesión.
