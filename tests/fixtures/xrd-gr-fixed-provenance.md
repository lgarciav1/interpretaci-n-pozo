# Referencias de calibración GR con extremo externo

`xrd-gr-fixed-known.json`: generado independientemente en Python invirtiendo por bisección las ecuaciones publicadas de lineal, Larionov terciario/antiguo, Clavier y Steiber. Para clean fijo usa proxies [0,35;0,45;0,55;0,65;0,8;0,95]; para shale fijo [0,05;0,15;0,25;0,35;0,5;0,65]. Extremos conocidos 30/120 gAPI. No llama a las funciones de producción ni representa un ensayo real.

`xrd-gr-calibration-v1.json`: recibo sintético producido por la versión P5a del PR #52 (`2e487cb`), extraído del archivo `applied.pozo.json` del recorrido de navegador. Conserva la forma y los valores originales para comprobar lectura de v1 sin generar el supuesto legado con el lector/constructor nuevo. Su revisión/fecha/huellas pertenecen al fixture sintético y no son credenciales ni evidencia de laboratorio real.
