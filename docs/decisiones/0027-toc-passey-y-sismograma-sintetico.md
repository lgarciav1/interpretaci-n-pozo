# 0027 — TOC de Passey y sismograma sintético (fase 9d)

- Estado: implementada, pendiente de revisión para integrar.
- Alcance: Geo-4 (`passey-toc`) y Geo-6 (`synthetic-seismogram`).
- Base: `main`, a184a8bd1f13c116140c8b1e1f900845d84efec2, después de integrar PRs #19, #20 y #21.

## Contexto

El TP aporta DT, ZDEN, AT90 y GR. DT se reconoce como µs/ft en
`src/io/mnemonics.ts`; el lector convierte otras unidades a esa unidad canónica.
Los últimos 70 registros carecen de DT: 8508,0348–8518,5504 m. No se extrapola
la lentitud ni el tiempo hasta el fondo. El resultado es una interpretación
configurable; no una medición de carbono ni un amarre sísmico.

## D1. Passey, madurez y línea base

El motor puro aplica ΔlogR = log10(R/Rbase) + 0,02(DT−DTbase), con DT en
µs/ft; Passey et al. (1990), AAPG Bulletin 74(12), ec.1, p.1780. La escala
es 50 µs/ft por ciclo logarítmico. Los puertos de superposición conservan
coordenadas relativas a la base: log10(R/Rbase) y −0,02(DT−DTbase), por lo
que la separación reproduce ΔlogR, sin recalcular en el visor.

TOC = ΔlogR × 10^(2,297−0,1688LOM), expresado en porcentaje en peso.
La transcripción del coeficiente es la relación de Passey; **página exacta y
numeración de esta ecuación en el original SIN VERIFICAR**. El caso numérico
del test es calculado a mano, identificado como tal, no un dato de corona
atribuido al artículo. Las separaciones negativas se conservan; TOC se limita
a cero antes de sumar el fondo configurable. Faltantes y entradas inválidas
quedan NaN. Se avisa fuera de LOM7–12, rango principal señalado en p.1792.

La línea base puede ser manual o mediana de un intervalo. Las medianas usan
los mismos pares válidos R–DT; un intervalo inválido no cae silenciosamente
a la opción manual. Se puede copiar el intervalo visible del visor, o editar
tope y base. Bases manuales 1 ohm·m y100 µs/ft son ilustrativas (fig.2,p.1780),
no una calibración del TP. LOM10, umbral0,3 y GR75 son decisiones operativas
ajustables y marcadas SIN VERIFICAR como criterios universales. La bandera
«posible roca generadora» requiere separación y GR altos; no prueba TOC.

## D2. Modelo acústico y tiempos

Vp = 0,3048/(DT×10⁻⁶) m/s. AI = ρ[g/cm³]×Vp/1000 en MRayl. El motor
calcula Rc = (AI₂−AI₁)/(AI₂+AI₁), y tiempo doble por integración trapezoidal
con profundidad en metros, entregado en milisegundos. Se conserva el tiempo
inicial ajustable; cero implica tiempo relativo al tope, no tiempo absoluto.
Referencia: Yilmaz (2001), Seismic Data Analysis, 2.ª ed., SEG; página
específica SIN VERIFICAR para estas relaciones acústicas.

Los check-shots opcionales del motor deben ser estrictamente crecientes en
profundidad y tiempo. Reemplazan la integración sólo entre sus pares; no se
extrapolan. Esta fase no incorpora un cargador de check-shot en el panel.
Un hueco sónico sin resolver invalida la acumulación posterior. Una densidad
faltante invalida AI y las reflexiones/convolución cercanas, aunque el tiempo
sónico siga siendo conocido. La curva Rc en profundidad asigna la interfaz
entre muestras i−1/i a la profundidad de i; el Rc temporal usa la frontera
correcta entre los bloques, sin corrimiento de medio paso.

## D3. Bloqueo temporal y ondícula

Antes de calcular Rc se promedia AI por duración en bins temporales regulares
de1–2 ms. Cada muestra del perfil representa su celda limitada por los puntos
medios de los tiempos vecinos. No se promedian coeficientes de reflexión.
`time[i]` es la frontera izquierda del bin de AI[i]; Rc[i] representa el
contraste entre bins i−1 e i en esa frontera. Así la convolución no agrega
un desplazamiento de medio bin. Sólo se usan bins completos dentro de la
cobertura conocida; el tramo final menor que dt no se prolonga.

La Ricker es (1−2π²f²t²)exp(−π²f²t²), t en segundos. Fuente verificada:
Wang (2015), «The Ricker wavelet and the Lambert W function», GJI200,
p.112, ec.3, DOI10.1093/gji/ggu384. Frecuencia por defecto30Hz, decisión
operativa. Convolución de impulsos discretos sin factor dt: un Rc0,2 produce
una ondícula de pico0,2. Normal de fase cero: un aumento de AI da pico
central positivo; invertida cambia todo el signo. SEG/Sheriff (2002),
Dictionary, figuraP-6; página impresa SIN VERIFICAR.

Soporte±3/f, límite de memoria200.000 bins y despike3MAD son elecciones
numéricas SIN VERIFICAR como constantes bibliográficas. El despike se aplica
antes del suavizado mediano; ambas etapas respetan huecos. La interpolación
interna sólo se activa explícitamente, con tamaño máximo configurable, y
nunca completa extremos. Las entradas originales no se modifican. La
convolución usa ceros fuera del intervalo conocido; sus bordes carecen de
reflexiones externas al perfil y deben interpretarse con esa limitación.

## D4. Módulos, pistas y exportaciones

Cada módulo agrega su carpeta y registro en `src/modules/index.ts`. Las
pistas se descubren por `overlay.ts`, mediante `OverlayTrackDecl.spec`
para separación Passey/TOC/bandera/AI/Rc, y dibujo propio para el wiggle.
El wiggle repite cuatro veces la misma traza, con relleno positivo y cortes
en NaN; las repeticiones no son trazas sísmicas medidas.

Fuera de las carpetas nuevas: dos motores y sus tests; registro de módulos;
`src/core/units.ts` agrega dimensiones genéricas tiempo, velocidad e
impedancia y unidades s/ms, m/s, MRayl. Esta ampliación es necesaria para
mostrar, convertir y exportar unidades reales, sin etiquetarlas adimensionales.
No hay cambios al visor ni imports de módulos desde visor/núcleo.

El panel ofrece CSV temporal (ms, MRayl, Rc y amplitud), CSV métrico de la
ley tiempo–profundidad y LAS de la traza remapeada en profundidad. Usa
`downloadFile` existente y el escritor LAS de `src/io/export`. El CSV temporal
tiene encabezado propio porque el exportador de perfiles exige profundidad
métrica; no se disfraza tiempo como profundidad. Faltantes: celdas vacías en
CSV y NULL del LAS. En el panel se aclara que atar a sísmica real requiere
SEG-Y, fuera de alcance. Las ecuaciones quedan sólo en ModuleDocs/Ecuaciones.

## Resultados del TP con valores de fábrica

Base manualR=1, DT=100, LOM10, fondo0. Estos valores ilustran el método y
requieren calibración en una lutita no generadora antes de usar el TOC.

| Zona | Muestras válidas | ΔlogR mínimo–máximo | TOC mínimo–máximo (% peso) | TOC medio (% peso) |
| --- | ---: | --- | --- | ---: |
| A | 599 | −0,764–0,595 | 0–2,417 | 0,063 |
| B | 1192 | −0,394–0,979 | 0–3,981 | 0,614 |
| C | 419 | −0,777–0,207 | 0–0,842 | 0,009 |
| D | 1818 | −0,810–0,516 | 0–2,099 | 0,057 |
| E | 1712 | −0,779–1,164 | 0–4,732 | 0,037 |

Tiempo doble conocido: **489,859054 ms**, desde7633,2588 hasta8507,8824m.
Paso2ms:244 bins completos. **El tiempo total hasta8518,5504m es desconocido**:
los últimos10,668m no tienen DT. Se conservan70NaN legítimos, y no aparecen
NaN en AI temporal ni en la traza temporal del tramo cubierto.

## Verificación

Tests analíticos de ΔlogR, TOC manual, Ricker (pico/ceros/espectro), escalón,
dos capas, integración, unidades, polaridad, check-shot, composición de
preprocesados, faltantes y CSV del TP. Tests de integración para tabla de
módulo, CSV, LAS y dibujo con huecos. Revisión independiente de motores y
arquitectura realizada por otro agente. Capturas en claro/oscuro en
`docs/capturas/9d/`. La validación final se detalla en el PR.
