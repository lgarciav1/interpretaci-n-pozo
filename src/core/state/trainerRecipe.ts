import type { TrainerRecipe } from '../../petro/trainer';

/** Receta de archivo. Se reconstruye el objeto para descartar campos ajenos al contrato. */
export function readTrainerRecipe(value: unknown): TrainerRecipe | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { version, seed, noise } = value as Partial<TrainerRecipe>;
  if (version !== 1 || typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || typeof noise !== 'boolean') return undefined;
  return { version, seed, noise };
}
