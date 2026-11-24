import profiles from '../../datos/pozo_tp_perfiles.csv?raw';
import { emptyInterpretation, type Interpretation } from '../../src/core/interpretation';
import { readWellFile } from '../../src/io';

export const { well, zones } = readWellFile(profiles, 'pozo_tp_perfiles.csv');
export const zoneId = (name: string) => zones.find((zone) => zone.name === name)!.id;
export const interpretation: Interpretation = {
  ...emptyInterpretation(zones),
  sources: {
    PHIS: { kind: 'module', moduleId: 'phi-sonic-wyllie' },
    PHIE: { kind: 'module', moduleId: 'phie-shale-corrected' },
    RW: { kind: 'module', moduleId: 'rw-manual' },
    SW: { kind: 'module', moduleId: 'sw-archie' },
  },
  params: {
    global: {
      'vsh.method': 'linear',
      'phi-density.rhoMa': 2.65,
      'phi-density.rhoFl': 1,
      'phi-sonic-wyllie.dtFl': 189,
      'phi-sonic-wyllie.cp': 1,
      'phie-shale-corrected.phiSh': 0.25,
      'rw-manual.rwRef': 0.02,
      'rw-manual.correct': false,
      a: 1, m: 2.22, n: 2.059,
      permCutoffOn: false,
    },
    zones: {
      [zoneId('A')]: { grClean: 60, grShale: 110, 'phit.method': 'densityNeutronGas' },
      [zoneId('B')]: {
        grClean: 45, grShale: 95, 'phit.method': 'sonic', dtMa: 54,
        vshCutoff: 0.15, phiCutoff: 0.12, swCutoff: 0.5,
      },
    },
  },
};
