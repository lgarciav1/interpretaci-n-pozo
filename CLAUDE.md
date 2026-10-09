# Webapp de interpretación de registros de pozo

TP de Interpretación de Perfiles (FIUBA, 2C 2026). Webapp multimodular y autocontenida para interpretar perfiles de pozo: carga de datos, visor multipista, interpretación petrofísica, zonas, cutoffs, sumario y módulos adicionales. Entrega: diciembre 2026.

El plan completo (funcionalidades por ola, fases, arquitectura) está en el doc "Plan del proyecto" del proyecto de claude.ai: https://claude.ai/code/artifact/c610f6b0-b814-47fe-ab9e-59a12f3798df. Si no podés leerlo, pedí a la usuaria las partes que necesites.

## Módulos obligatorios del profesor (MVP, no negociables)
1. **Visualizador** multipista.
2. **Presiones MDT:** presión vs. profundidad, gradientes por fluido, densidad de fluido y contactos, superpuesto al visualizador.
3. **Crossplot libre:** cualquier curva contra cualquier otra en dos clics, color por tercera curva o por capa, cutoffs arrastrables en X e Y, filtro por capa.
4. **Datos de corona:** carga de plugs (φ, k, densidad de grano), puesta en profundidad corona–perfil, puntos sobre el visualizador, modelo k–φ.
5. **Histograma:** cualquier curva, cutoff arrastrable, superposición de histogramas de varias capas.
6. **Gradientes y líneas de tendencia:** sobre cualquier curva o gráfico, ajuste lineal/log/exponencial/potencial con ecuación y R², gradientes en unidades de campo (presión, temperatura, compactación).

Si una decisión de diseño compite con alguno de estos, gana el módulo obligatorio.

## Prioridades (en este orden)
1. Petrofísica correcta y validada contra ejemplos de libro.
2. Calidad visual excelente: más moderna que el software de la industria, respetando sus convenciones de lectura (colores por curva, escala log para resistividad, rellenos).
3. Flujo completo y fluido: un pozo interpretado de punta a punta en menos de 5 minutos.
4. Interactividad: sliders y parámetros elegidos sobre los gráficos, con recálculo en vivo.
5. Extensibilidad: agregar un módulo = una carpeta + un registro, sin tocar el núcleo.

## Stack y reglas técnicas
- TypeScript + React + Vite. Todo corre en el navegador, sin servidor. El build final debe poder generar un único archivo HTML que se abra con doble clic y funcione sin internet.
- Entrada principal: Excel (.xlsx). También LAS 2.0 y CSV.
- Visor de perfiles dibujado en canvas (rendimiento con decenas de miles de muestras). Cálculos pesados en Web Worker.
- Motor de cálculo (`src/petro/`): funciones puras, sin UI, todas con tests (Vitest) contra resultados conocidos.
- Las ecuaciones no se muestran en la interfaz; solo en el módulo Ecuaciones.
- Código: identificadores en inglés. Interfaz, documentación y mensajes de commit en español.

## Estructura
```
src/
  core/      modelo de datos (pozo, curvas, zonas, parámetros), registro de módulos, grafo de cálculo, estado, unidades
  io/        lectores Excel/LAS/CSV, tabla de mnemónicos, exportadores
  petro/     motor de cálculo puro
  modules/   una carpeta por funcionalidad, cada una cumple el contrato de módulo
  viewer/    visor multipista
  plots/     histogramas y crossplots
  ml/        clasificación de litologías (ola 4)
  ui/        sistema de diseño: tokens, componentes
  app/       pantallas, espacios de trabajo (Petrofísica, Geología), navegación
tests/
docs/
datos/       datos del pozo del TP (ver datos/README.md)
```
Cada módulo declara: id, nombre, categoría, espacio de trabajo, curvas de entrada (por rol), esquema de parámetros (genera los sliders), curvas de salida, función de cálculo pura y documentación para el módulo Ecuaciones.

## Datos
- `datos/pozo_tp_perfiles.csv`: solo perfiles medidos (nada interpretado), 5810 muestras, 7633–8518 m cada 0,1524 m, zonas A–E. Problemas de calidad conocidos en `datos/README.md` (sirven como casos de prueba del control de calidad).

## Orquestación
La sesión principal orquesta: planifica, delega en subagentes, revisa todo lo que vuelve e integra. Antes de lanzar un subagente, escribí una línea: tarea → subagente → motivo.

| Subagente | Modelo · esfuerzo | Para qué |
|---|---|---|
| `explorador` | Haiku 5.5 · medio | Lo más barato: buscar en el código, correr tests/build y resumir, cambios mecánicos, completar tablas con un patrón, leer y resumir documentación |
| `investigador` | Sonnet · medio | Default para tareas con criterio: investigación, lectura de archivos, redacción, tests simples, lectores con especificación clara, tareas repetitivas |
| `analista-numerico` | Sonnet · alto | Ecuaciones petrofísicas, algoritmos numéricos, ML, verificación matemática |
| `desarrollador-ui` | Opus · medio | Componentes y pantallas estándar, módulos nuevos sobre la arquitectura existente, integración |
| `arquitecto` | Opus · alto | Arquitectura, sistema de diseño, visor multipista, interacciones visuales complejas |

Reglas:
- Escalá un nivel si la tarea define algo que otras partes heredan, si es matemática no trivial, o si un intento previo falló la revisión.
- El motor petrofísico y la arquitectura los revisa un subagente distinto del que los escribió.
- Cada brief es autocontenido: objetivo, contexto, archivos, criterio de terminado, formato de respuesta.
- Plan Pro con límite de uso: pocos subagentes bien definidos antes que muchos en paralelo. Todo lo mecánico va a `explorador` (Haiku), que cuesta unas 20 veces menos que Sonnet.

Orquestador recomendado por fase (lo elige la usuaria en el selector): Opus alto para arquitectura (1), sistema de diseño (3), visor (4) y sarta (11); Sonnet medio para lectura de datos (2) y pulido (12); Opus medio para el resto. Al empezar una sesión, decí qué fase toca y qué configuración conviene.

## Git
- Autor de commits: Lucas <lgarciav@fi.uba.ar> (configurado en el repo).
- Cada fase termina con un commit y la app funcionando; nunca dejar la app rota entre commits.
- La carpeta está en OneDrive: si aparecen conflictos en `.git`, avisar.
