/**
 * Microanimación sobria al cambiar un valor: devuelve 'a' | 'b' | undefined para `data-flash`, alternando para
 * reiniciar la animación CSS (`.ui-flash`) en cada cambio. No anima el primer render. Con movimiento reducido las
 * duraciones son 0 y no se ve nada.
 */
import { useEffect, useRef, useState } from 'react';

export function useFlash(value: unknown): 'a' | 'b' | undefined {
  const [n, setN] = useState(0);
  const prev = useRef(value);
  useEffect(() => {
    if (Object.is(prev.current, value)) return;
    prev.current = value;
    setN((k) => k + 1);
  }, [value]);
  return n === 0 ? undefined : n % 2 ? 'a' : 'b';
}
