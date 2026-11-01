/**
 * REGISTRO DE MÓDULOS — el único archivo a tocar para agregar un módulo (una línea por módulo).
 *
 * El orden importa: es el orden de los paneles y el desempate por defecto cuando varios módulos producen el
 * mismo puerto (gana el primero, salvo que el usuario elija otro).
 *
 * Este archivo lo importa el Web Worker: solo puede importar definiciones puras (`<id>/index.ts`), nunca paneles.
 */
import passeyToc from './passey-toc';
import syntheticSeismogram from './synthetic-seismogram';
import sedColumn from './sed-column';
import lithologyFacies from './lithology-facies';
import electrofacies from './electrofacies';
import electrofaciesScan from './electrofacies-scan';
import { createRegistry } from '../core/registry';
import igr from './igr';
import vsh from './vsh';
import phiDensity from './phi-density';
import phiNeutron from './phi-neutron';
import phiSonicWyllie from './phi-sonic-wyllie';
import phiSonicRaymer from './phi-sonic-raymer';
import phit from './phit';
import phieVsh from './phie-vsh';
import phieShaleCorrected from './phie-shale-corrected';
import coreCalibration from './core-calibration';
import tempGradient from './temp-gradient';
import rwManual from './rw-manual';
import rwSp from './rw-sp';
import rwRwa from './rw-rwa';
import swArchie from './sw-archie';
import swSimandoux from './sw-simandoux';
import swIndonesia from './sw-indonesia';
import bvwSh from './bvw-sh';
import swiPc from './swi-pc';
import permTimur from './perm-timur';
import permCoates from './perm-coates';
import nmrFluids from './nmr-fluids';
import permCore from './perm-core';
import rockTyping from './rock-typing';
import cutoffs from './cutoffs';
import cutoffSensitivity from './cutoff-sensitivity';
import zoneSummary from './zone-summary';
import volumetrics from './volumetrics';
import flowCapacity from './flow-capacity';
import uncertainty from './uncertainty';
import indGasCrossover from './ind-gas-crossover';
import indShale from './ind-shale';
import indCoal from './ind-coal';
import indWashout from './ind-washout';
import wellReading from './well-reading';
import invasionStep from './invasion-step';
import zoneSuggestions from './zone-suggestions';
import electrosequences from './electrosequences';
import clayTyping from './clay-typing';
import mineralInversion from './mineral-inversion';
import preparation from './preparation';
import { SHARED_PARAMS } from './sharedParams';

export const MODULES = [
  igr,
  vsh,
  phiDensity,
  phiNeutron,
  phiSonicWyllie,
  phiSonicRaymer,
  phit,
  phieVsh,
  phieShaleCorrected,
  coreCalibration,
  tempGradient,
  rwManual,
  rwSp,
  rwRwa,
  swArchie,
  swSimandoux,
  swIndonesia,
  bvwSh,
  swiPc,
  permTimur,
  permCoates,
  nmrFluids,
  permCore,
  rockTyping,
  cutoffs,
  cutoffSensitivity,
  zoneSummary,
  volumetrics,
  flowCapacity,
  uncertainty,
  indGasCrossover,
  indShale,
  indCoal,
  indWashout,
  wellReading,
  invasionStep,
  zoneSuggestions,
  electrosequences,
  clayTyping,
  mineralInversion,
  passeyToc,
  syntheticSeismogram,
  sedColumn,
  lithologyFacies,
  electrofacies,
  electrofaciesScan,
];

/**
 * Módulos de panel (docs/decisiones/0058): herramientas de la interfaz sin puertos ni cálculo en el motor, con su
 * documentación para el módulo Ecuaciones. También una línea por módulo.
 */
export const PANEL_MODULES = [preparation];

/** Parámetros compartidos: ver sharedParams.ts (el registro exige que coincidan con ese catálogo). */
export const registry = createRegistry(MODULES, { sharedParams: SHARED_PARAMS, panels: PANEL_MODULES });

