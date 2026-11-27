/**
 * Sugerencias dinámicas y autocompletado determinista del Asistente v2 (0094).
 */
import { coreSets } from '../../modules/core/model';
import { pressureSets } from '../../modules/mdt/model';
import { micpSamples } from '../../modules/micp/model';
import { fold } from '../../ui/commands';
import { CURVES } from './intents';
import type { AssistantContext, AutocompleteItem } from './types';

export function buildDynamicChips(context: AssistantContext): string[] {
  const zones = context.zones.filter((z) => z.kind !== 'seal');
  const firstZone = zones[0] ?? context.zones[0];
  const secondZone = zones[1] ?? context.zones[1];

  const chips: string[] = [];
  if (firstZone) {
    chips.push(`¿Por qué la zona ${firstZone.name} tiene poco pay?`);
  }
  if (firstZone && secondZone) {
    chips.push(`Compará ${firstZone.name} vs ${secondZone.name}`);
  } else {
    chips.push('¿Qué zona tiene más pay?');
  }
  chips.push('¿Cómo está la coherencia cruzada?');
  chips.push(
    firstZone
      ? `¿Qué pasa si pongo φ a 0,12 y Sw a 0,55 en zona ${firstZone.name}?`
      : '¿Qué pasa si pongo Sw a 0,55?',
  );
  chips.push(
    firstZone
      ? `Resaltá donde φ > 0,15 y Sw < 0,4 en zona ${firstZone.name}`
      : 'Resaltá donde φ > 0,15 y Sw < 0,4',
  );

  const well = context.well;
  if (well && pressureSets(well.pointSets).length > 0) {
    chips.push('Resumen de presiones MDT');
  } else if (well && micpSamples(well.pointSets).length > 0) {
    chips.push('Resumen de MICP');
  } else if (well && coreSets(well.pointSets).length > 0) {
    chips.push('Calibración con corona');
  } else {
    chips.push('¿Cómo funciona Archie?');
  }
  return chips.slice(0, 6);
}

export function buildAutocomplete(draft: string, context: AssistantContext): AutocompleteItem[] {
  const q = fold(draft).trim();
  if (!q) return [];

  const zones = context.zones;
  const firstZ = (zones.find((z) => z.kind !== 'seal') ?? zones[0])?.name ?? 'D';
  const secondZ = (zones.find((z) => z.kind !== 'seal' && z.name !== firstZ) ?? zones[1])?.name;
  const midDepth = context.well?.depth.values.length
    ? Math.round(context.well.depth.values[Math.floor(context.well.depth.values.length / 2)]!)
    : 7850;

  const catalog: AutocompleteItem[] = [
    { id: 't-comp-pay', text: '¿Qué zona tiene más pay?', category: 'Comparación' },
    { id: 't-comp-ng', text: '¿Qué zona tiene mejor N/G?', category: 'Comparación' },
    { id: 't-comp-all', text: 'Compará todas las zonas', category: 'Comparación' },
    ...(secondZ
      ? [{ id: 't-comp-pair', text: `Compará ${firstZ} vs ${secondZ}`, category: 'Comparación' }]
      : []),
    { id: 't-ooip', text: '¿Cuánto petróleo in situ (OOIP) hay?', category: 'Volumetría' },
    { id: 't-ogip', text: `¿Cuánto gas in situ hay en zona ${firstZ}?`, category: 'Volumetría' },
    { id: 't-sim-2d', text: `¿Qué pasa si pongo φ a 0,12 y Sw a 0,55 en zona ${firstZ}?`, category: 'Simulación 2D' },
    { id: 't-stab', text: 'Estabilidad 2D de cutoffs', category: 'Cutoffs (G09)' },
    { id: 't-filter', text: `Resaltá donde φ > 0,15 y Sw < 0,4 en zona ${firstZ}`, category: 'Filtro visor' },
    { id: 't-why-depth', text: `¿Por qué a ${midDepth} m no es pay?`, category: 'Profundidad' },
    { id: 't-prov', text: `¿De dónde sale PHIE a ${midDepth} m?`, category: 'Origen' },
    { id: 't-cc', text: '¿Cómo está la coherencia cruzada?', category: 'Auditoría (G08)' },
    { id: 't-mdt', text: 'Resumen de presiones MDT', category: 'Presiones (G05)' },
    { id: 't-smlp', text: 'Unidades hidráulicas SMLP y Lorenz', category: 'Flujo (G03)' },
    { id: 't-cgr', text: 'Calibración CGR y aporte de uranio', category: 'Espectral (G06)' },
    { id: 't-sxo', text: 'Resumen de movilidad Sxo y MOS', category: 'Movilidad (G07)' },
    { id: 't-micp', text: 'Resumen de MICP y capacidad de sello', category: 'MICP' },
    { id: 't-layers', text: 'Capas de pay y punzados sugeridos', category: 'Punzados' },
    { id: 't-unc', text: 'Incertidumbre P90 P50 P10 y tornado', category: 'Incertidumbre' },
    { id: 't-core', text: 'Calibración con corona y ρmaa', category: 'Corona' },
    { id: 't-diff', text: '¿Qué cambié en la interpretación?', category: 'Snapshots' },
    { id: 't-prep', text: '¿Qué excluí en Preparación?', category: 'Preparación' },
    { id: 't-miss', text: '¿Por qué no calcula Sxo?', category: 'Diagnóstico' },
    { id: 't-warn', text: '¿Qué avisos hay?', category: 'Avisos' },
    { id: 't-next', text: '¿Qué paso sigue?', category: 'Flujo' },
  ];

  // Zonas concretas del pozo
  for (const z of zones.slice(0, 6)) {
    catalog.push({ id: `z-pay-${z.id}`, text: `Pay neto en zona ${z.name}`, category: `Zona ${z.name}` });
    catalog.push({ id: `z-poco-${z.id}`, text: `¿Por qué la zona ${z.name} tiene poco pay?`, category: `Zona ${z.name}` });
  }

  // Curvas medidas presentes en el pozo + roles estándar
  const presentRoles = new Set<string>(['SW', 'PHIE', 'VSH', 'RT', 'GR']);
  if (context.well) {
    for (const c of context.well.curves) {
      if (c.role) presentRoles.add(c.role);
    }
  }
  for (const role of [...presentRoles].slice(0, 8)) {
    const alias = Object.entries(CURVES).find(([, r]) => r === role)?.[0] ?? role;
    catalog.push({
      id: `c-show-${role}`,
      text: `Mostrame ${role} en la zona ${firstZ}`,
      category: 'Visor',
      hint: alias !== role.toLowerCase() ? alias : undefined,
    });
  }

  // Fichas de Ecuaciones
  for (const eq of context.equations) {
    catalog.push({ id: `eq-${eq.id}`, text: `¿Cómo funciona ${eq.name}?`, category: 'Ecuaciones' });
  }

  const terms = q.split(/\s+/).filter(Boolean);
  const scored: { item: AutocompleteItem; score: number }[] = [];
  const seen = new Set<string>();

  for (const item of catalog) {
    const fText = fold(item.text);
    const fCat = fold(item.category);
    const fHint = item.hint ? fold(item.hint) : '';
    const hay = `${fText} ${fCat} ${fHint}`;
    if (!terms.every((t) => hay.includes(t))) continue;
    if (seen.has(fText)) continue;
    seen.add(fText);
    const score = (fText.startsWith(q) ? 100 : fText.includes(q) ? 60 : 20) - item.text.length * 0.1;
    scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 6).map((s) => s.item);
}
