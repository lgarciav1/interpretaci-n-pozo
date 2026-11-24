# F17 · Lupa sobre el perfil

Pozo del TP cargado con «Cargar datos del TP», vista del pozo entero (1:10.000). Puntero sobre la pista de
Resistividad a 8142,7 m (zona D, cruce densidad–neutrón) y tecla **L**: el recuadro muestra ese tramo a 1:200 con la
profundidad fija a la izquierda, Resistividad (escala logarítmica) y Densidad · neutrón con su relleno. Sobre el visor
general, el rectángulo de acento marca el tramo y las pistas que muestra la lupa. Chromium de Playwright, 1366 × 768,
deviceScaleFactor 1.

- [Tema claro](lupa-claro.png)
- [Tema oscuro](lupa-oscuro.png)

## Cómo se generaron y qué comprueba el recorrido

```sh
npm run build
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist &
QA_URL=http://127.0.0.1:4173/index.html NODE_PATH=<carpeta con playwright> node scripts/qa/lupa.cjs
```

El recorrido abre la lupa con L, la cierra con Esc y la vuelve a abrir; comprueba el encabezado «1:200», la rueda
(1:200 → 1:100 → 1:200 → 1:500), la apertura desde la paleta («lupa») y las tres entradas de la hoja de atajos, sin
errores de página. Mide además los cuadros con la lupa abierta (ver el ADR 0085 y la respuesta de la fase).
