# Instrucciones para Codex y sus subagentes

Leé `CLAUDE.md`: sus prioridades, alcance, stack, convenciones, contratos, datos y reglas de Git también se
aplican a Codex. Este archivo adapta la orquestación y las herramientas; no reemplaza los requisitos del producto.
Para nuevas funciones, leé además la sección 2 y la ficha correspondiente de
`docs/masterplan-funciones-nuevas.md` (o, para la ola final G01–G08 en Antigravity con Orchestrator Neon,
`docs/masterplan-ola-final.md` y `docs/cadena-ola-final.md`). Si se está ejecutando la cadena, leé el archivo de
cadena correspondiente.
Las instrucciones explícitas del usuario y del entorno prevalecen sobre los archivos del repositorio.

## Orquestación en Codex

La sesión principal planifica, delega tareas concretas, revisa lo recibido e integra. Usá pocos subagentes y asigná
alcances separados. Antes de cada lanzamiento, escribí en español: «tarea → subagente → motivo».
No delegues una misma escritura a dos agentes ni ejecutes pruebas pesadas simultáneamente con el navegador.

Los nombres de la tabla de `CLAUDE.md` son **roles**, no dependencias de un proveedor. En Codex se asignan como
nombre y brief de un subagente disponible. Conservá las instrucciones sustantivas de cada ficha en
`.claude/agents/`, omitiendo su frontmatter específico de Claude (`model`, `effort`, `color`). No afirmes que se
está usando Haiku, Sonnet u Opus cuando no están disponibles. Por defecto, los subagentes heredan el modelo y
esfuerzo de la sesión; no hace falta cambiar de modelo para separar responsabilidades y revisión.

| Rol | Ficha que debe leer | Responsabilidad |
|---|---|---|
| `explorador` | `.claude/agents/explorador.md` | Buscar y resumir código, verificaciones y cambios mecánicos acotados. |
| `investigador` | `.claude/agents/investigador.md` | Investigación, documentación, lectores y tests con especificación clara. |
| `analista-numerico` | `.claude/agents/analista-numerico.md` | Petrofísica, algoritmos numéricos, ML y validación contra referencias independientes. |
| `desarrollador-ui` | `.claude/agents/desarrollador-ui.md` | Componentes, formularios y módulos sobre los contratos y el sistema de diseño existentes. |
| `arquitecto` | `.claude/agents/arquitecto.md` | Contratos y decisiones transversales, visor, interacciones complejas y revisión de piezas críticas. |

Si una tarea cambia algo que otras partes heredan, contiene matemática no trivial o falló una revisión, reforzá
el brief y asigná al rol especializado correspondiente. Las recomendaciones de modelos de Claude no son requisitos
para trabajar en Codex ni motivo suficiente para interrumpir una tarea viable con las capacidades disponibles.

## Brief y revisión independiente

Cada asignación debe incluir objetivo, contexto, base/rama, archivos, límites de escritura, criterios de aceptación,
verificaciones y formato de respuesta. Como comparten el workspace, los agentes deben conocer qué archivos son suyos;
no deben revertir cambios ajenos, integrar ni publicar por su cuenta salvo asignación expresa de la sesión principal.

Quien revisa debe ser un **subagente distinto del autor**, también si ambos usan el mismo modelo.
Para motor petrofísico y arquitectura esto es obligatorio; la cadena de funciones exige revisión aparte por función.
Si escribió la sesión principal, un subagente puede hacer la revisión independiente. Una auto-revisión no la sustituye.

El revisor busca bugs, regresiones, violaciones de contrato, cálculos incorrectos y problemas de interacción o
rendimiento, no preferencias de estilo. Debe informar gravedad, archivo/línea, caso reproducible y verificaciones
realizadas; si no encuentra problemas, debe decirlo y registrar los límites de su revisión.
La sesión principal resuelve los hallazgos y pide al revisor que compruebe los arreglos antes de integrar.

## Entrega y continuidad

- Una función por rama y PR; commits y descripción en español, autor según `CLAUDE.md`.
- Decisión antes del código cuando la ficha lo exige. Campos nuevos opcionales y JSON puro; preservar proyectos,
  originales, snapshots e invariantes científicas.
- Cumplir la ficha completa, typecheck, tests, build autocontenido y capturas solicitadas. Registrar comandos,
  resultados y límites sin declarar aprobadas pruebas que no se ejecutaron.
- Un fallo de tiempo requiere diagnóstico: repetir sin otras cargas cuando corresponda, sin relajar umbrales para
  obtener verde. Distinguir la ejecución completa de una repetición parcial en la evidencia.
- Si una política del entorno bloquea `file://`, registrar el error y verificar lo posible con el mismo HTML servido
  localmente y sin red después de cargar. Esto **no sustituye** la prueba por doble clic ni permite declararla aprobada.
- Actualizar masterplan y arquitectura según el resultado real. No marcar «hecha» ni integrar si falta un criterio
  obligatorio o persisten hallazgos. Se puede dejar un PR en borrador con evidencia y pendientes concretos.
- Integrar solo dentro de lo autorizado por el usuario y con los requisitos de la cadena cumplidos; no añadir una
  confirmación rutinaria cuando ya existe autorización.
- `create_session` de `claude-code-remote` solo se usa si realmente está disponible. Un subagente de Codex no equivale
  a una nueva sesión remota. Si falta esa herramienta, dejar identificada la siguiente función y su prompt, sin
  afirmar que se lanzó. Continuar en la sesión actual únicamente dentro del alcance autorizado.
