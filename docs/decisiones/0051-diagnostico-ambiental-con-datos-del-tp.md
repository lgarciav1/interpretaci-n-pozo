# 0051 — P7a: diagnóstico ambiental con los datos disponibles del TP

Fecha: 2026-11-01. Implementado sobre P6/PR #57, sin integrar main.

## Alcance acordado

El usuario indicó que parte de la información de adquisición es imposible de verificar en un TP de facultad y pidió limitar el trabajo a los datos disponibles. La entrega del TP usa el CSV existente y el material de la cátedra que esté disponible. Los modelos/condiciones desconocidos se conservan como desconocidos; no condicionan la interpretación con las curvas entregadas ni se completan por mnemónico. MGT permanece opcional y sus requisitos científicos no se relajan.

Este PR implementa el frente de diagnóstico integrado de P7. Las correcciones ambientales adicionales que requieren información inaccesible quedan fuera del alcance actual del TP. No se declara que se hayan implementado esas correcciones ni que el diagnóstico confirme invasión, baritina, revoque o standoff. La puerta científica general de P7 se conserva para cualquier método futuro.

## Datos y cálculos admitidos

«Preparar datos → Diagnóstico ambiental con datos disponibles» observa originales importados: CALI/BS, PEF/RHOB y RA10/RA20/RA30/RM/RT. Una curva única por rol se sugiere; varias requieren elección. Una selección inválida o unidad incompatible queda sin entrada, sin sustituirse silenciosamente. Se convierten explícitamente las magnitudes compatibles a pulgadas, b/e, g/cm³ y Ω·m. La selección de fuentes petrofísicas, curvas preparadas, exclusiones de herramientas y módulos no altera esta base: el panel declara que observa originales y muestra la fuente explícita vigente por separado.

Se respeta el tramo inclusivo del editor; ambos extremos vacíos significan todo el pozo. Un tramo parcial/inválido exige corregir sus límites. Las zonas usan `layoutZones`, incluida la política existente de solapamiento y el grupo fuera de zonas. Los recuentos son de muestras, no espesores ni netos. Cada indicador tiene su denominador válido y varias alertas pueden coexistir.

| Observación | Procedimiento | Límite de interpretación |
|---|---|---|
| Caliper bajo mínimo | CAL finito menor que mínimo operativo (por defecto 5 in, criterio QC existente del TP) | Revisión de lectura; no se transforma ni elimina el dato. Es configurable, no un mínimo universal de herramientas. |
| Ensanchamiento | CAL válido − BS medido > tolerancia (por defecto 1 in, misma función `isWashout` del QC) | Requiere par válido, BS positivo. Sin BS no se inventa trépano. |
| CAL menor que BS | Diferencia negativa entre par válido | Revisión geométrica; no se calcula espesor de revoque. |
| PE sospechoso | `detectSuspectPe` existente: PE >4 y RHOB <2,55, con par finito y densidad positiva | Criterio operativo ADR 0029; no confirma composición del lodo ni corrige PE. |
| Separación resistiva | Máxima/mínima −1 en al menos tres lecturas positivas finitas; criterio ajustable | Contraste observado; no demuestra invasión ni identifica respuesta del fabricante. |

Se muestran totales/zonas, soportes, primera profundidad con alerta y lecturas canónicas a la muestra más cercana dentro del tramo. Los controles de criterios permiten explorar sensibilidad y se exportan con el resultado; son estado de vista, sin agregar revisiones ni entradas de historial al proyecto.

## Hipótesis radial explícita

La casilla «Explorar hipótesis de inducción de arreglo» arranca desactivada. Activarla usa las curvas originales seleccionadas con `resolveInvasionInputs` y `radialViewAt` existentes (ADR 0020), sin ajustar todo el pozo. Se mantienen las sensibilidades radiales aproximadas, los parámetros globales/zonales del módulo, observaciones, modelo, residuo y estados: aceptable, dudoso, mal determinado, no resuelto, sin invasión visible e insuficiente.

El trépano del modelo usa BS válido o el parámetro existente; la UI y el JSON distinguen esa hipótesis del uso exclusivo de BS medido en el conteo geométrico. Los umbrales del modelo zonal se muestran separados del criterio del resumen. No se publican nuevas curvas Rt/Rxo ni se cambia la fuente de la cadena. El modelo no adquiere categoría de corrección certificada al abrir este panel.

## Matriz de compatibilidad y doble corrección

| Operación | Entradas/efectos | Política |
|---|---|---|
| Diagnóstico observacional | Originales seleccionadas, procesado incluso desconocido | Solo lectura: ninguna corrección ni nueva curva. Puede observar originales aunque exista preparación activa. |
| Hipótesis radial del panel | Originales + hipótesis explícita; sensibilidades aproximadas | Solo lectura por muestra; sin aceptación ni selección automática de Rt. |
| Limpieza P3 | Recetas existentes sobre originales | Se conserva su contrato. No se habilita composición con GR MGT ni caliper requerido por MGT activo. |
| MGT P6 | Modelo/condiciones confirmados, entradas originales calibradas | Se conservan ADR 0050 y las barreras de adquisición desconocida, efectos previos, caliper preparado y doble aplicación. Una receta idéntica es no-op. |
| Nuevas correcciones de pozo/rugosidad/salinidad | Método y datos específicos aún no disponibles | Fuera del alcance actual del TP; no se habilitan por registrar una hipótesis radial o revisar alertas. |

La tabla de procesado del panel muestra efectos adquiridos, receta habilitada/desactivada y fuente explícita. Una receta habilitada puede estar invalidada: su disponibilidad efectiva sigue en los controles de preparación existentes. No se confunde receta con fuente ni lista vacía de efectos con prueba de perfil crudo.

## Evidencia portable y compatibilidad

«Exportar diagnóstico ambiental» descarga JSON con versión propia del informe, pozo/revisión, tramo, entradas/unidades, criterios, adquisición sin completar, totales/zonas, muestra inspeccionada, hipótesis radial cuando está activada y limitaciones. Los NaN se serializan como null. Este resumen acompaña el proyecto/CSV: no sustituye las curvas originales completas.

No cambian Project v7, adquisición 1, preparación 5 ni los lectores/exportadores de datos existentes; no hay dependencias nuevas. El diagnóstico no usa resultados atrasados del motor ni necesita que termine un preview: su base son las originales del proyecto vigente.

Referencias de los procedimientos existentes: [QC](0003-control-de-calidad.md), [modelo radial y límites](0020-perfil-radial-de-invasion.md), [PE sospechoso](0029-pe-sospechoso-y-inversion-sin-pe.md), [contrato MGT](0050-primer-metodo-ambiental-mgt.md). No se incorpora un nuevo algoritmo de corrección del fabricante ni material de terceros.
