/**
 * Sistema de diseño — punto de entrada. Importar desde acá: `import { Button, Slider, curveStyle } from '../ui'`.
 * Guía de uso: src/ui/README.md. Decisiones: docs/decisiones/0004-sistema-de-diseno.md.
 */
export { BASE_TOKENS, THEMES, cssVarName, installTokens, tokensToCss, type ThemeTokens, type ThemeColors, type ViewerColors } from './tokens';
export {
  getResolvedTheme,
  getThemePreference,
  getThemeTokens,
  initTheme,
  prefersReducedMotion,
  setThemePreference,
  subscribeTheme,
  useResolvedTheme,
  useThemePreference,
  useThemeTokens,
  type ThemeName,
  type ThemePreference,
} from './theme';
export { CURVE_PALETTE, CURVE_SWATCHES, FILL_PALETTE, ZONE_PALETTE, curveStyle, dashPattern, fillColor, zoneColor, categoricalColor, type CurveStyle, type FillId, type LineStyle } from './curves';
export { contrastRatio, ensureContrast, mix, withAlpha } from './color';
export { decimalsForStep, formatNumber, formatParamValue, parseDecimal } from './format';
export { positionToValue, stepValue, valueToPosition } from './scale';

export { BrandMark, Icon, ICON_NAMES, type IconName } from './components/Icon';
export { Button, IconButton, type ButtonProps, type ButtonVariant } from './components/Button';
export { Checkbox, SegmentedControl, Switch, TabPanel, Tabs, type SegmentOption, type TabItem } from './components/Choice';
export { Field, NumberField, Select, Slider, SliderField, TextField, type SelectOption } from './components/Fields';
export { Badge, Callout, Chip, EmptyState, StatusDot, type Tone } from './components/Feedback';
export { Dialog } from './components/Dialog';
export { Menu, type MenuEntry } from './components/Menu';
export { Popover } from './components/Popover';
export { ColorPicker } from './components/ColorPicker';
export { Toaster, dismissToast, toast } from './components/Toast';
export { Tooltip } from './components/Tooltip';
export { Panel, ResizeHandle, Section } from './components/Layout';
export { DataTable, type Column } from './components/DataTable';
export { Spinner } from './components/Spinner';
export { Stepper, type StepperItem, type StepperStatus } from './components/Stepper';
export { WizardSteps, type WizardStep } from './components/WizardSteps';
export { FileDrop } from './components/FileDrop';
export { ThemeToggle } from './components/ThemeToggle';
export { useFlash } from './components/useFlash';
export { CurveLegend, CurveSwatch } from './components/CurveLegend';
