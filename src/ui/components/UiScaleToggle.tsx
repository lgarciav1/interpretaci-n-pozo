/** Selector de tamaño de interfaz: compacto / normal / grande (preferencia de este navegador, nunca del proyecto). */
import type { IconName } from './Icon';
import { setUiScale, useUiScale } from '../uiScale';
import { UI_SCALES, type UiScale } from '../tokens';
import { SegmentedControl } from './Choice';

const ICON: Record<UiScale, IconName> = { compact: 'text-size-sm', normal: 'text-size-md', large: 'text-size-lg' };

export function UiScaleToggle({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const scale = useUiScale();
  return (
    <SegmentedControl<UiScale>
      aria-label="Tamaño de la interfaz"
      size={size}
      value={scale}
      onChange={setUiScale}
      options={UI_SCALES.map((s) => ({ value: s.id, icon: ICON[s.id], title: `Tamaño ${s.label.toLowerCase()}` }))}
    />
  );
}
