/**
 * CATÁLOGO DE PARÁMETROS COMPARTIDOS — el lugar canónico de los parámetros que usan varios módulos
 * (p. ej. Rw, a, m, n en Archie, Simandoux e Indonesia).
 *
 * Un parámetro compartido se guarda una sola vez y tiene un único control: si dos métodos lo usan, mover el slider
 * afecta a los dos (comparar Archie con Simandoux con el mismo Rw). Los módulos NO copian el spec: lo toman de acá,
 *
 *     params: { rw: SHARED_PARAMS.rw, rsh: param.number({...}) }
 *
 * y el registro verifica que todo parámetro con `shared: true` esté en este catálogo y sea idéntico.
 * Definición pura (la importa el worker).
 */
import { param, type ParamsSpec } from '../core/params';

export const SHARED_PARAMS = {
  grClean: param.number({
    label: 'GR de arena limpia',
    tooltip: 'Lectura de rayos gamma en la arena más limpia de la zona.',
    default: 30,
    min: 0,
    max: 150,
    step: 0.5,
    unit: 'gAPI',
    scope: 'zone',
    shared: true,
  }),
  grShale: param.number({
    label: 'GR de arcilla',
    tooltip: 'Lectura de rayos gamma en las arcillas de la zona.',
    default: 120,
    min: 20,
    max: 300,
    step: 0.5,
    unit: 'gAPI',
    scope: 'zone',
    shared: true,
  }),
} satisfies ParamsSpec;
