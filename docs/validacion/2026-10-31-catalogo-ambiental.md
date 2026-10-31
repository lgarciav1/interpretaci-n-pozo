# P6a — Catálogo ambiental y adquisición reversible

Fecha: 2026-10-31. Base `3f4cb7ddc7ea89714b86efbcda38b45b68bd9598` (#54), rama de revisión. Main intacto. [Contrato ADR 0048](../decisiones/0048-catalogo-ambiental-y-adquisicion.md).

## Resultado y alcance

El catálogo releva seis familias y expone faltantes científicos/de adquisición, compatibilidad y riesgo de doble corrección. Ninguna entrada es ejecutable. Registrar herramienta/modelo/efectos previos crea una revisión de adquisición reversible y conserva medidas, fuentes y preparación. No introduce fórmula, curva corregida, umbral QC ni cambios de formato.

El fixture de [adquisición](../../tests/fixtures/environment.ts) es **sintético explícito**: GR, densidad/PE, AT90 y geometría, dos asignaciones de corrida sin herramienta/modelo/procesado confirmados. Los nombres de proveedor/modelo/referencia de las pruebas son QA; no son datos de campo ni permiso de aplicar un método.

## Pruebas de dominio y estado

Suite completa: **2.860 pruebas en 168 archivos**, sin fallos ni omisiones, 134,09 s con un worker; typecheck/build/diff check aprobados. HTML final **5.726.030 bytes**, SHA-256 `2a4f09701b2fc3ab9b643b86d78cb3c9dcb550e1d976136c0e6d5908b789b1b4` (+13.795 bytes, ~0,241 % sobre #54), sin dependencias nuevas. Project v7, adquisición 1 y preparación 4 sin cambios. Tras ajustar únicamente rótulos de usuario, se repiten typecheck, las diez pruebas específicas y el recorrido sobre el HTML final.

Diez pruebas nuevas, `environment-catalog.test.ts`: catálogo no ejecutable aun con declaraciones completas; atribución por mnemónico distinta de adquisición; dos físicas con RT; curvas/unidades relevadas y DRHO ausente; procesado desconocido/declarado vacío, efecto previo o desconocido; unidad/origen/herramienta incompatibles; revisión sin modificar originales/interpretación/otras corridas; no-op/freeze; contexto obsoleto y declaraciones inválidas/duplicadas; preservación de ids/efectos no reconocidos y lodo existente; undo/redo, archivo y snapshots. Con máscara previa, cambia el contexto de revisión y mantiene exactamente arrays/calidad preparados.

## Navegador

Chromium, HTML de producción por HTTP local, 1366×900. La curva sin corrida mantiene ese estado; el catálogo muestra DRHO ausente y el riesgo de sumarla a RHOB; completar declaraciones no elimina la falta de admisión científica. Confirmación obligatoria y reiniciada al editar. Un borrador cerrado deja Project intacto. Aceptación agrega una revisión, preserva blobs/Well/interpretación/otra corrida y guarda método/versión/referencia. Un undo/redo recupera proyectos completos.

Un contexto nuevo abre el archivo y recupera referencias. Después se modifica el modelo y se quita el efecto mediante el editor: restaurar el snapshot recupera la revisión/declaración previa. Offline sin Worker ni SubtleCrypto registra lo mismo y conserva blobs. Sin excepciones de página. [Resultado y capturas](2026-10-31-catalogo-ambiental/navegador.json).

Capturas revisadas del HTML final: [catálogo sin adquisición confirmada](2026-10-31-catalogo-ambiental/catalogo.png) y [efecto adquirido registrado, todavía no ejecutable](2026-10-31-catalogo-ambiental/efecto-registrado.png).

## Reproducción

```sh
npm ci
npm run typecheck
npm test -- --maxWorkers=1
npm run build
node scripts/qa/environment-seed.mjs /tmp/p6a-seed
python -m http.server 4178 --directory dist
# Otra terminal, con Playwright Python y Chromium:
python scripts/qa/environment.py --seed /tmp/p6a-seed --output /tmp/p6a-browser
```

P6 continúa pendiente del primer método con herramienta y referencias/casos admitidos. Las referencias descriptivas del catálogo no certifican un modelo ni sustituyen carta/dominio/licencia. Ampliar propiedades de lodo requiere contrato versionado. No se repite toda la matriz visual/DPR/temas ni benchmark; no se prueba file://, limitado por política de la sesión previa. Offline se verifica tras cargar el HTML por HTTP y cortar la red. No se cierran issues ni se integra la cadena de PRs.
