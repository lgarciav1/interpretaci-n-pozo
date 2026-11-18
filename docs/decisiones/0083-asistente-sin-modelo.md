# ADR 0083 · Asistente sin modelo (F26)

## Contexto

Durante la defensa, una pregunta sobre el pozo puede requerir navegar por el visor, abrir una explicación o localizar
un dato ya calculado. La aplicación tiene que funcionar desde un único HTML sin conexión y conservar la trazabilidad.

## Decisión

El panel Asistente toma una consulta por vez. Una gramática cerrada reconoce frases completas en español, ignorando
tildes y mayúsculas, y admite variantes de uso habitual. Cada intención devuelve texto y acciones declarativas sin
consultar stores. El panel conecta esas acciones con la navegación existente y las ejecuta al pulsar un botón.

| Intención | Respuesta y acción |
| --- | --- |
| Ver GR, Rt, Vsh, PHIE o Sw en una zona | Llevar el visor al intervalo y destacar la curva cuando está en la plantilla |
| Consultar espesores, N/G, promedios de pay o el motivo de poco pay | Leer el Sumario por zona y mostrar bruto, reservorio neto, pay y espesor sin dato al explicar la clasificación |
| Consultar el efecto de un cutoff | Leer el barrido de un solo umbral y contrastar el punto vigente con el punto evaluado más próximo al solicitado. Mostrar el umbral real del barrido y mantener los demás cortes fijos |
| Consultar la lectura de fluidos o tramos | Mostrar la primera interpretación pertinente de Lectura automática, con el carácter de indicio y su evidencia |
| Explicar un método | Buscar en el catálogo de Ecuaciones, ofrecer coincidencias si el nombre es ambiguo y abrir la ficha elegida |
| Revisar avisos | Mostrar los diagnósticos del motor del ámbito solicitado y abrir Avisos |
| Elegir el siguiente paso | Usar la sugerencia del flujo y ofrecer el enlace al paso. Si se agotó el flujo, ofrecer Sumario |

La respuesta cita el nombre y el identificador de cada fuente numérica. Los faltantes mantienen su condición de
sin dato. Los términos de búsqueda de método y zona se resuelven contra los nombres vigentes. Los nombres ambiguos
requieren precisión. Para consultas que quedan fuera de la gramática se sugieren hasta tres comandos de navegación
pertinentes de la paleta, con ejemplos si no hay coincidencia. La búsqueda difusa se limita a sugerir comandos
y nunca clasifica resultados petrofísicos.

El panel opera sobre el pozo activo y sus resultados vigentes. Reevalúa la pregunta cuando cambia el resultado y la
limpia al pasar a otro pozo. No modifica la interpretación, no registra historial en el proyecto y no usa red. Las
ecuaciones se mantienen en la pantalla Ecuaciones. El asistente lee el barrido y el sumario del motor y no simula
escenarios nuevos ni atribuye causas geológicas a la diferencia entre reservorio y pay.

## Alternativas

Un modelo local ocuparía mucho más espacio y dificultaría garantizar la procedencia de las cifras. Uno remoto
introduciría red y saldría del contrato autocontenido. La búsqueda libre en los textos de ayuda sigue disponible
en Ecuaciones y la paleta. La gramática permite probar las respuestas con un guion de defensa y localizar la
fuente de cada número.
