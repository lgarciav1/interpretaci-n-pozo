/** Selector de tema: sistema / claro / oscuro (preferencia guardada en este navegador, nunca en el proyecto). */
import { setThemePreference, useThemePreference, type ThemePreference } from '../theme';
import { SegmentedControl } from './Choice';

export function ThemeToggle({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const pref = useThemePreference();
  return (
    <SegmentedControl<ThemePreference>
      aria-label="Tema"
      size={size}
      value={pref}
      onChange={setThemePreference}
      options={[
        { value: 'system', icon: 'monitor', title: 'Tema del sistema' },
        { value: 'light', icon: 'sun', title: 'Tema claro' },
        { value: 'dark', icon: 'moon', title: 'Tema oscuro' },
      ]}
    />
  );
}
