# 0049 — P6: evaluación del primer método ambiental

> Evaluación histórica superada por [ADR 0050](0050-primer-metodo-ambiental-mgt.md): se leyó la referencia MGT completa y se implementó su modelo con guardas explícitas, limitación de incertidumbre y casos matemáticos independientes. Se completa la implementación y el contraste que esta evaluación no había agotado. No se modifica la puerta de P6 ni se presenta la validación numérica como certificación de campo.

Fecha: 2026-10-31. Estado: **admisión pendiente; P6 bloqueada en su puerta científica**, sobre P6a (#55). No cambia producción ni admite un evaluador.

## Puerta que se intentó cerrar

El [masterplan, secciones 8 y 13](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/masterplan-preparacion-drx/docs/masterplan-preparacion-y-drx.md) exige un primer método para una herramienta concreta con referencia y casos independientes. Una definición requiere entradas/unidades, condiciones, dominio, política fuera de dominio, efectos/incompatibilidades, incertidumbre o limitación explícita, referencia localizada y tratamiento de redistribución. El catálogo de P6a no sustituye esa definición.

La falta de modelo confirmado del TP impide aplicar al TP, pero **no impediría por sí sola implementar un método para otra herramienta** con casos verificables. Tampoco se exige aquí completar la campaña real de P8. La brecha de esta evaluación es el contrato numérico verificable del primer método.

## Candidatas investigadas

| Candidata | Fuente primaria revisada | Decisión |
|---|---|---|
| Corrección ambiental MGT | Goldberg et al., 2004, Proc. ODP, Sci. Results 191, cap. 6, pp. 5, 9–10 y 18–21 | Tiene ecuaciones y herramienta concreta. No admitida con la evidencia obtenida. |
| Compensación de densidad Comprobe | Scott, 1978, USGS Open-File Report 78-515, DOI 10.3133/ofr78515 | Resumen accesible; informe completo no recuperado. No admitida. |
| Arps para resistividad de fluidos | Funciones existentes `src/petro/temperature.ts` y `brine.ts` | Es cálculo de propiedades del fluido; no cierra la puerta de una corrección ambiental de herramienta. |

**MGT.** [Artículo completo](https://www-odp.tamu.edu/publications/191_SR/VOLUME/CHAPTERS/004.PDF) y [apéndice B](https://www-odp.tamu.edu/publications/191_SR/004/004_14.htm). Publica polinomios distintos según posición. Sus tablas AT1/AT2 son de calibración, no casos completos de corrección ambiental. La aplicación descrita usa caliper limitado y advierte que la corrección es parcial. No se confirmó un dominio validado ni un caso numérico independiente completo para admitirla. No convertir el alcance del caliper en límite científico del polinomio ni inventar extrapolaciones. Recalcular la misma ecuación en Python verificaría programación, no resolvería esa evidencia faltante.

**Comprobe.** [Resumen oficial USGS](https://www.usgs.gov/publications/a-computer-program-borehole-compensation-dual-detector-density-well-logs). Identifica una sonda dual de 5,4 cm y necesita cuentas de detectores cercano/lejano, geometría y nivel de agua; sus ecuaciones no son transferibles a otra sonda. El [PDF oficial](https://pubs.usgs.gov/of/1978/0515/report.pdf) devolvió HTTP 403 mediante navegador de investigación y descarga normal por el proxy de sesión. Sin informe no se verificaron coeficientes, dominio, programa ni casos de referencia. ZDEN/DRHO no sustituyen cuentas crudas de detectores.

## Redistribución

No se incorporaron cartas, imágenes, tablas, PDF ni datasets ajenos. No se asume que acceso público equivalga a permiso sobre material de terceros. La [política IODP actual](https://publications.iodp.org/policies.html) no se toma como confirmación automática de licencia para cada componente de un artículo ODP de 2004 o una carta de fabricante citada. Una implementación propia de ecuaciones y fixtures sintéticos debe distinguirse de redistribuir esos materiales; esto no elimina las brechas científicas anteriores.

## Material mínimo para desbloquear

Una de las siguientes rutas basta; no hace falta conseguir ambas:

1. MGT: procedimiento/carta o referencia adicional que permita justificar el dominio, condiciones/unidades y un caso ambiental de entrada/salida verificable, con tolerancia y estado de corrección. Las referencias originales citadas por el artículo son puntos de partida, no documentos ya revisados/aprobados.
2. Comprobe: copia accesible del informe USGS 78-515 con algoritmo/calibración y caso de referencia; confirmar geometría exacta, unidades y rango del modelo antes de portar su programa.
3. Otra herramienta: manual/publicación localizable con la misma información y material reutilizable o sin necesidad de redistribuir recursos del fabricante.

Después se debe implementar y probar evaluador puro, límites/nulos, unidades alternativas, prevención de doble corrección, ledger, preview aislado, aceptación reversible y persistencia. El primer método puede validarse con un proyecto sintético explícito de su herramienta; eso no certifica el TP ni reemplaza P8.

## Verificación de esta entrega

Solo documentación: no cambia `src`, dependencias, datos, formato ni catálogo ejecutable. `git diff --check` aprobado; no se repite la suite por este cambio documental. La base P6a documenta 2.860 pruebas en 168 archivos y navegador/offline. El HTML disponible conserva SHA-256 `2a4f09701b2fc3ab9b643b86d78cb3c9dcb550e1d976136c0e6d5908b789b1b4`; no se presenta como un nuevo build científico.

P6 sigue sin método numérico admitido. No se cierra #32, no se declara avance numérico de P7 y no se integra ningún PR en main.
