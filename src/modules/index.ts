/**
 * REGISTRO DE MÓDULOS — el único archivo a tocar para agregar un módulo (una línea por módulo).
 *
 * El orden importa: es el orden de los paneles y el desempate por defecto cuando varios módulos producen el
 * mismo puerto (gana el primero, salvo que el usuario elija otro).
 *
 * Este archivo lo importa el Web Worker: solo puede importar definiciones puras (`<id>/index.ts`), nunca paneles.
 */
import { createRegistry } from '../core/registry';
import igr from './igr';
import shaleFlag from './shale-flag';

export const MODULES = [
  igr,
  shaleFlag,
];

export const registry = createRegistry(MODULES);
