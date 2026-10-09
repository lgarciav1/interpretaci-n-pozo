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
import vsh from './vsh';
import phiDensity from './phi-density';
import phiNeutron from './phi-neutron';
import phiSonicRaymer from './phi-sonic-raymer';
import phit from './phit';
import phieVsh from './phie-vsh';
import phieShaleCorrected from './phie-shale-corrected';
import tempGradient from './temp-gradient';
import rwManual from './rw-manual';
import swArchie from './sw-archie';
import swSimandoux from './sw-simandoux';
import swIndonesia from './sw-indonesia';
import bvwSh from './bvw-sh';
import permTimur from './perm-timur';
import permCoates from './perm-coates';
import { SHARED_PARAMS } from './sharedParams';

export const MODULES = [
  igr,
  vsh,
  phiDensity,
  phiNeutron,
  phiSonicRaymer,
  phit,
  phieVsh,
  phieShaleCorrected,
  tempGradient,
  rwManual,
  swArchie,
  swSimandoux,
  swIndonesia,
  bvwSh,
  permTimur,
  permCoates,
];

/** Parámetros compartidos: ver sharedParams.ts (el registro exige que coincidan con ese catálogo). */
export const registry = createRegistry(MODULES, { sharedParams: SHARED_PARAMS });
