/**
 * Documentación de paneles que no son módulos del motor, para la pantalla «Ecuaciones». Cada una tiene la misma forma
 * que `docs` de un módulo y se agrupa en una categoría conocida del registro.
 */
import { FORMATION_WATER_DOCS } from '../../modules/formation-water/docs';
import type { ExtraDocs } from './model';

export const EQUATION_EXTRAS: readonly ExtraDocs[] = [{ id: 'formation-water', name: 'Calculadora de agua de formación', category: 'water', docs: FORMATION_WATER_DOCS }];
