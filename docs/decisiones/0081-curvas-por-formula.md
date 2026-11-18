# 0081. Curvas calculadas por fórmula (F06)

## Contexto

Una curva creada en la interpretación debe viajar por el mismo grafo y los mismos consumidores que las demás salidas del motor. Sus dependencias solo se conocen al leer la expresión.

## Decisión

La gramática admite números decimales (también en notación científica), referencias, signos unarios, paréntesis y las funciones indicadas abajo. Las operaciones binarias asocian a izquierda dentro de su nivel. Los espacios se ignoran entre tokens. El analizador de descenso recursivo consume toda la entrada y señala la columna del error. La expresión se limita a 512 caracteres para acotar el trabajo y la profundidad.

```ebnf
expresión = término, { ("+" | "-"), término };
término   = unario, { ("*" | "/"), unario };
unario    = ("+" | "-"), unario | átomo;
átomo     = número | referencia | "(", expresión, ")" | llamada;
llamada   = ("log" | "exp"), "(", expresión, ")"
          | ("min" | "max"), "(", expresión, ",", expresión, ")";
referencia = ["@"], identificador;
identificador = [A-Za-z_][A-Za-z0-9_]*;
número = ([0-9]+ ("." [0-9]*)? | "." [0-9]+) ([eE] [+-]? [0-9]+)?;
```

Las referencias y funciones ignoran mayúsculas. Un identificador simple busca primero un mnemónico entre las curvas elegibles. Si hay varios, se rechaza la referencia y se indica cómo usar un rol explícito con `@`. Si no hay ninguno, se usa el rol homónimo, incluida una salida de fórmula. `@ROL` usa directamente la selección del grafo. Una referencia ausente genera diagnóstico y bloquea la fórmula y sus dependientes. Las referencias por mnemónico operan en la unidad almacenada y las referencias por rol en la unidad canónica.

Cada definición genera un módulo puro en el registro de la corrida, con una salida identificada por el mnemónico de la fórmula. Sus entradas se declaran una vez analizada la expresión. El contrato de curvas admite fijar una entrada a un id de curva, para mnemónicos incluso sin rol. Las referencias por rol siguen la selección normal del grafo, permitiendo que una fórmula que se refiere a sí misma llegue a la detección de ciclos. Se usa el orden topológico y la detección de ciclos existentes. Antes de guardar se planifica la interpretación candidata y se rechaza si la fórmula editada queda sin entradas o en un ciclo o depende de él. La definición anterior permanece disponible hasta que se acepte el cambio.

El resultado lleva la unidad que declare el usuario, por defecto sin unidad. Es una etiqueta del valor calculado, sin inferencia dimensional ni conversión implícita del resultado. Para `PHIE*(1-SW)` se puede declarar `v/v`. `log` es natural. Toda entrada faltante o no finita, división por cero y resultado intermedio o final no finito producen `NaN` en esa muestra. El exportador escribe el nulo LAS y conserva la fórmula en la descripción de la columna.

Se guarda una lista opcional de hasta 64 definiciones de mnemónico, expresión y unidad en `Interpretation.formulas`. Los nombres tienen hasta 32 caracteres, empiezan con una letra y son únicos y no pueden pisar mnemónicos, roles ni puertos existentes. Los archivos sin el campo se abren con la lista vacía. Se incluye el campo en la identidad del contexto de cálculo y la comparación de entradas. La caché de cada módulo incorpora la expresión y la unidad además de las fuentes y sus versiones.

## Alternativas descartadas

Ejecutar JavaScript con `eval` o `Function` admitiría operaciones fuera del lenguaje y acceso al entorno. Calcular desde la interfaz dejaría fuera del grafo las dependencias, la caché y los snapshots. La inferencia de unidades requeriría reglas dimensionales y conversiones que estas fórmulas numéricas no expresan.
