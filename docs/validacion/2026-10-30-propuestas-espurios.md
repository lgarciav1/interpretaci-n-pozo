# P3b · Propuestas locales de espurios

Base: #45, commit `7c1550d6fefa82b5719b17c614ff51a1b6e5445a`. Rama `codex/propuestas-espurios-p3b`, apilada sin integrar PRs. [Contrato y límites del método](../decisiones/0037-propuestas-locales-de-espurios.md).

## Resultado

Se pueden buscar posibles espurios sobre originales, revisar mediana/umbral, elegir muestras individuales y previsualizar su exclusión como una sola decisión reversible. El diagnóstico no identifica con certeza mediciones erróneas. No sustituye valores y no guarda una receta de detección: conserva exclusiones manuales de las muestras elegidas. Esto se indica expresamente en la UI.

**2.722 pruebas en 157 archivos**, seis nuevas; sin fallos ni omisiones. Typecheck, build y diff check aprobados. Tras ajustar la comprobación de cancelación inmediatamente después de ceder el hilo, se repitieron las seis pruebas del método y el build. Los casos nuevos verifican el cálculo independiente de mediana/MAD (mediana 3,5; MAD 1,5; umbral 6,6717), piso y desigualdad estricta cuando MAD es cero, signo, tendencia y escalón, bordes, NaN, máscaras y saltos MD. También parámetros/índice inválidos, integridad por bytes, cancelación por bloques, truncamiento explícito y lote atómico con guardado/relectura y undo/redo.

## Navegador

Chromium real sobre el HTML de producción, HTTP local, 1366×768, tema claro, TP completo. El script `scripts/qa/suspects.py` comprueba:

- [7800,7900] m MD, desviación mínima 1 API, separación máxima 0,2 m: **14 candidatos entre 650 centros evaluados**. Son datos del ensayo, no parámetros recomendados.
- Ninguna muestra seleccionada por defecto. Se revisa y elige una: 7805,3184 m MD. La búsqueda y el preview no ejecutan el motor principal; cancelar conserva el Project completo y escritura v6.
- Cambiar selección o límites invalida el preview antes de aceptar. La comparación local se centra en la primera muestra elegida.
- Aplicar crea un único intervalo cerrado de ancho cero, activa v7 y selecciona la preparada. Undo/redo recuperan exactamente los proyectos antes/después. Guardar/reabrir en otro contexto conserva la decisión; restaurar esa exclusión la elimina.
- Sin excepciones de página. [Captura del preview](../capturas/propuestas-espurios/preview.png) revisada; lista de candidatos acotada con scroll y footer accesible.

También se recorre `scripts/qa/preparation.py`: máscara manual [7800,7810], 65 mediciones excluidas, originales y 5.810 filas conservados; exportación LAS con calidad verificada muestra a muestra; undo/redo, recuperación full única de un paquete incompleto, reabrir/restaurar snapshot, rechazo de método futuro y fallback offline sin Worker/SubtleCrypto. Los hashes y comprobaciones se archivan en el JSON de evidencia.

## Rendimiento y tamaño

El mismo ensayo Node/Vite SSR de identidad, TP y siete cambios tras un warmup, sobre fuentes de #45 y candidato: medianas **56,0792 → 56,0781 ms**, razón **0,99998×**, bajo 1,25. Misma huella científica `e9cb7cbe45d6ba0144dd225d22ffd975524f34dda4442df5beccbbdb5ce456fa`, bytes y buffers originales conservados. Rondas secuenciales sin suite ni navegadores activos. No mide la velocidad del detector, latencia del worker/UI, ni garantiza tiempos en otros equipos. Warmups y todas las muestras se conservan en [evidencia JSON](metricas/2026-10-30-propuestas-espurios.json).

HTML: **5.573.231 bytes**, +6.250 respecto de #45 (0,112 %). SHA-256: `629a22a647222a553d3f4e68130259ac415c8530ffdad704ff31a0e3732b1cda`. Sin dependencias nuevas.

## Reproducir

```sh
npm ci
npm test -- --maxWorkers=1
npm run typecheck
npm run build
node scripts/qa/archive_v7.mjs /tmp/p3b-seed
python -m http.server 4178 --directory dist
# En otra terminal:
python scripts/qa/suspects.py --candidate index.html --seed /tmp/p3b-seed --output /tmp/p3b-browser
python scripts/qa/preparation.py --candidate index.html --seed /tmp/p3b-seed --output /tmp/p3b-regression
node scripts/qa/preparation.mjs /tmp/identity.json identity
```

Ejecutar la última medición desde ambos checkouts con las mismas dependencias. El primer intento del script nuevo usaba un locator del contexto ya cerrado al probar la restauración; se corrigió el ensayo, sin cambiar producto para ese error. La ejecución final incluye la restauración en el contexto nuevo.

## Límites y próximo paso

No se repitió la matriz visual amplia de todas las pantallas/temas del padre. No se verifica file:// ni rendimiento en el equipo objetivo. Los candidatos carecen de flag Suspect persistido y de parámetros/evidencia históricos del diagnóstico: se guarda la decisión manual explícita. El método puede señalar señales geológicas reales y no detecta toda anomalía. No se presenta como detector universal por herramienta.

Continúan pendientes otros métodos de preparación, filtros/interpolación, alineación, DRX y correcciones ambientales. No se declara terminada toda P3 ni se cierran #31/#32/#34. El original y main se conservan.
