# 0019 — Capacidad de flujo, incertidumbre y lectura automática (fase 8c, funciones S, I y T)

- Estado: aceptada (fase 8c).
- Alcance:
  - **S:** `src/petro/flowCapacity.ts`, módulo `src/modules/flow-capacity/` (cálculo, `model.ts`, panel).
  - **I:** `src/petro/uncertainty.ts`, módulo `src/modules/uncertainty/` (cálculo, `model.ts`, panel).
  - **T:** `src/petro/wellReading.ts`, módulo `src/modules/well-reading/` (cálculo, `model.ts`, panel).
- Los tres son módulos de categoría `summary` (paso Sumario). Sin cambios en el núcleo ni en el formato del proyecto.
- Revisión numérica independiente de S e I: sin errores en S; en I se corrigió Spearman con zonas correlacionadas y se
  agregaron límites de área ≥ 0 y B > 0.

## S. Scribner & Engineer y Lorenz

- φ·h y k·h por tramo con porcentajes y acumulados; curva de Lorenz estratigráfica (orden de profundidad, Gunter et al.
  1997) y ordenada por k/φ decreciente; Lc = 2·(área bajo la ordenada − 0,5) (Lake y Jensen 1991).
- k del tramo agrupado: promedio aritmético ponderado por espesor (capas en paralelo). k ≤ 0 no aporta flujo pero su
  φ·h cuenta. Lc depende de la cantidad de tramos (máximo 1 − 1/N): por eso «muestras por tramo» es un parámetro.
- La referencia «Scribner & Engineer» no se pudo verificar en bibliografía; no se cita como fuente de las ecuaciones.
- UI: tabla de tramos paginada (100 + «Ver 500 más»), curvas decimadas a ≤ 1000 puntos, clic → salto al visor.

## I. Incertidumbre

- Monte Carlo con semilla (mulberry32) sobre área y B por zona, multiplicadores de φ y Sw y corrimientos de cutoffs
  (globales). Distribuciones uniforme, triangular y normal truncada. P90 = cuantil 10 % (estimación baja, SPE-PRMS).
- Simplificación: φ y Sw se perturban ya calculadas (no se recorre Rw/m/n → Sw).
- Zonas **correlacionadas** por defecto (decidido por la usuaria): suma conservadora; «independientes» como opción.
- Botón **Calcular** (decidido por la usuaria): el módulo solo simula con `calculate = true`; el panel guarda el
  resultado, vuelve el parámetro a false y avisa «Resultados desactualizados» si cambia cualquier parámetro. Así ningún
  slider dispara los ~300 ms de la simulación. Costo: el resultado no se guarda en el proyecto ni sale en la exportación.

## T. Lectura automática

- Reglas deterministas sobre NET_PAY / NET_RES, Sw, Rt relativa a la base acuífera de la zona (o del pozo) y los
  indicadores existentes (cruce densidad–neutrón, carbón, derrumbe). Fluido probable y confianza alta/media/baja según
  cuántas evidencias coinciden; derrumbe ≥ 20 % fuerza confianza baja. Contacto aparente si Sw sube ≥ 0,3 dentro de un
  reservorio continuo.
- Sw y Rt cuentan como evidencias separadas aunque Sw derive de Rt (documentado; ajustable).
- UI: líneas generales y tarjetas por tramo con salto al visor, filtros y «Copiar lectura» para el informe.
