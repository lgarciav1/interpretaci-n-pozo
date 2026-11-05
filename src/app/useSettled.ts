/**
 * El valor, pero recién cuando dejó de cambiar `ms` milisegundos (el primero, enseguida). Para cálculos de lectura que
 * no hace falta rehacer con cada resultado intermedio de un arrastre (percentiles, histogramas del resumen;
 * docs/decisiones/0068): durante el gesto se ve lo anterior y al soltar se calcula una vez.
 */
import { useEffect, useState } from 'react';

export function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (settled === value) return;
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]); // eslint-disable-line react-hooks/exhaustive-deps
  return settled;
}

/** Espera de fábrica (ms): más que el intervalo entre resultados de un arrastre, menos de lo que se nota al soltar. */
export const SETTLE_MS = 220;
