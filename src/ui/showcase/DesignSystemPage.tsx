/**
 * Página de muestra del sistema de diseño (`#ui` en la URL): todos los componentes, tokens y la paleta de curvas
 * en claro y oscuro. Se usa para la revisión visual con capturas; no es parte del flujo de la app.
 */
import { useState, type ReactNode } from 'react';
import { BUILTIN_ROLES, defaultRoleCatalog } from '../../core/roles';
import { CURVE_PALETTE, FILL_PALETTE, ZONE_PALETTE, curveStyle, type FillId } from '../curves';
import { formatNumber } from '../format';
import { useResolvedTheme, type ThemeName } from '../theme';
import { BASE_TOKENS, THEMES } from '../tokens';
import {
  Badge,
  BrandMark,
  Button,
  Callout,
  Checkbox,
  Chip,
  CurveLegend,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  Icon,
  ICON_NAMES,
  IconButton,
  Menu,
  NumberField,
  Panel,
  Section,
  SegmentedControl,
  Select,
  SliderField,
  Spinner,
  StatusDot,
  Stepper,
  Switch,
  TabPanel,
  Tabs,
  TextField,
  ThemeToggle,
  Toaster,
  Tooltip,
  toast,
  type StepperItem,
  type Tone,
} from '../index';
import { SampleLog } from './SampleLog';
import './showcase.css';

const TONES: Tone[] = ['neutral', 'accent', 'ok', 'warn', 'error', 'info'];
const TONE_LABEL: Record<Tone, string> = { neutral: 'Neutro', accent: 'Acento', ok: 'Bien', warn: 'Revisar', error: 'Error', info: 'Info' };

function Block({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <Panel title={title} className={wide ? 'showcase-block showcase-block--wide' : 'showcase-block'}>
      {children}
    </Panel>
  );
}

function Row({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="showcase-row">
      {label && <div className="showcase-row__label">{label}</div>}
      <div className="showcase-row__items">{children}</div>
    </div>
  );
}

function ColorSwatches() {
  const theme = useResolvedTheme();
  const c = THEMES[theme].color;
  const groups: [string, (keyof typeof c)[]][] = [
    ['Superficies', ['bg', 'surface', 'surfaceSubtle', 'surfaceRaised', 'surfaceHover', 'surfaceActive', 'surfaceInverse']],
    ['Texto y bordes', ['text', 'textMuted', 'textSubtle', 'border', 'borderStrong']],
    ['Acento', ['accent', 'accentHover', 'accentSoft', 'accentBorder', 'accentText', 'focus']],
    ['Estados', ['ok', 'okSoft', 'warn', 'warnSoft', 'error', 'errorSoft', 'info', 'infoSoft']],
  ];
  return (
    <div className="showcase-colors">
      {groups.map(([title, keys]) => (
        <div key={title}>
          <div className="ui-overline">{title}</div>
          <div className="showcase-swatches">
            {keys.map((k) => (
              <div key={k} className="showcase-swatch">
                <span style={{ background: c[k] }} />
                <code>{k}</code>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Typography() {
  const sizes = Object.entries(BASE_TOKENS.text);
  return (
    <div className="showcase-type">
      {sizes.reverse().map(([k, px]) => (
        <div key={k} className="showcase-type__row">
          <code>
            text-{k} · {px}px
          </code>
          <span style={{ fontSize: px, fontWeight: px >= 16 ? 600 : 400 }}>Interpretación de perfiles 0123456789</span>
        </div>
      ))}
      <div className="showcase-type__row">
        <code>num (tabulares)</code>
        <span className="num showcase-nums">
          <span>7.633,26</span>
          <span>8.518,11</span>
          <span>0,1524</span>
        </span>
      </div>
      <div className="showcase-type__row">
        <code>mono</code>
        <span className="mono">GR · RHOB · NPHI · AT90 · ZDEN</span>
      </div>
    </div>
  );
}

function Spacing() {
  return (
    <div className="showcase-spacing">
      {Object.entries(BASE_TOKENS.space)
        .filter(([, v]) => v > 0)
        .sort((a, b) => a[1] - b[1])
        .map(([k, v]) => (
          <div key={k} className="showcase-space">
            <span style={{ width: v }} />
            <code>space-{k}</code>
          </div>
        ))}
      <div className="showcase-radii">
        {Object.entries(BASE_TOKENS.radius).map(([k, v]) => (
          <div key={k} className="showcase-radius" style={{ borderRadius: Math.min(v, 28) }}>
            <code>{k}</code>
          </div>
        ))}
        {(['xs', 'sm', 'md', 'lg'] as const).map((k) => (
          <div key={k} className="showcase-shadow" style={{ boxShadow: `var(--shadow-${k})` }}>
            <code>shadow-{k}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

const STEPS: StepperItem[] = [
  { id: 'a', label: 'Cargar', status: 'done', hint: 'Completo' },
  { id: 'b', label: 'Calidad', status: 'done', hint: 'Completo' },
  { id: 'c', label: 'Zonas', status: 'skipped', hint: 'Saltado' },
  { id: 'd', label: 'Arcilla', status: 'partial', hint: 'En curso' },
  { id: 'e', label: 'Porosidad', status: 'todo', hint: 'Pendiente' },
  { id: 'f', label: 'Rw', status: 'empty', hint: 'Sin módulos todavía' },
  { id: 'g', label: 'Sumario', status: 'locked', hint: 'Necesita un pozo' },
];

function Controls() {
  const [seg, setSeg] = useState('global');
  const [sel, setSel] = useState('larionov');
  const [txt, setTxt] = useState('Caso base');
  const [num, setNum] = useState(0.35);
  const [lin, setLin] = useState(45);
  const [log, setLog] = useState(0.05);
  const [chk, setChk] = useState(true);
  const [sw, setSw] = useState(false);
  return (
    <div className="showcase-grid2">
      <div className="showcase-stack">
        <Field label="Control segmentado">
          <SegmentedControl
            aria-label="Zona"
            value={seg}
            onChange={setSeg}
            options={[
              { value: 'global', label: 'Global' },
              { value: 'a', label: 'A' },
              { value: 'b', label: 'B' },
              { value: 'c', label: 'C', disabled: true },
            ]}
          />
        </Field>
        <Field label="Selector" tooltip="Selector nativo estilizado: accesible y rápido con muchas opciones.">
          <Select
            value={sel}
            onChange={setSel}
            block
            groups={[
              { label: 'Arcillosidad', options: [{ value: 'linear', label: 'Vsh lineal' }, { value: 'larionov', label: 'Larionov (terciario)' }] },
              { label: 'Otros', options: [{ value: 'clavier', label: 'Clavier' }] },
            ]}
          />
        </Field>
        <Field label="Texto" hint="Ayuda debajo del campo.">
          <TextField value={txt} onChange={setTxt} icon="bookmark" block />
        </Field>
        <Field label="Número con unidad" tooltip="Acepta coma o punto. ↑/↓ cambian un paso; Mayús ×10." error={num > 0.4 ? 'Mayor que el máximo físico esperado (0,4).' : undefined}>
          <NumberField value={num} onChange={setNum} min={0} max={0.5} step={0.01} unit="v/v" width={140} />
        </Field>
        <Row label="Casillas">
          <Checkbox checked={chk} onChange={setChk} label="Usar corrección por arcilla" />
          <Switch checked={sw} onChange={setSw} label="Comparar" />
          <Checkbox checked={false} onChange={() => {}} label="Desactivada" disabled />
        </Row>
      </div>
      <div className="showcase-stack">
        <Field label="Slider lineal (GR de arcilla)" tooltip="Arrastrá o usá las flechas. La marca indica el valor por defecto." aside={<Badge tone="info" variant="outline">compartido</Badge>}>
          <SliderField value={lin} onChange={setLin} min={0} max={150} step={0.5} unit="gAPI" mark={{ value: 120, label: 'Por defecto' }} aria-label="GR de arcilla" />
        </Field>
        <Field label="Slider logarítmico (Rw)" tooltip="Escala log: cada década ocupa el mismo largo." aside={<Badge tone="warn">de la zona</Badge>}>
          <SliderField value={log} onChange={setLog} min={0.005} max={5} scale="log" unit="ohm·m" aria-label="Rw" />
        </Field>
        <Field label="Desactivado">
          <SliderField value={30} onChange={() => {}} min={0} max={150} step={1} unit="gAPI" disabled aria-label="Desactivado" />
        </Field>
        <Field label="Flujo guiado (Stepper)">
          <div className="showcase-stepper">
            <Stepper items={STEPS} activeId="d" suggestedId="e" onSelect={() => {}} aria-label="Ejemplo de pasos" />
          </div>
        </Field>
      </div>
    </div>
  );
}

function Overlays() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('results');
  return (
    <div className="showcase-stack">
      <Row label="Diálogo, menú, tooltip y avisos">
        <Button onClick={() => setOpen(true)} icon="bookmark">
          Abrir diálogo
        </Button>
        <Menu
          trigger={(p) => (
            <Button {...p} icon="folder" iconRight="chevron-down">
              Menú
            </Button>
          )}
          items={[
            { type: 'label', id: 'l', label: 'Proyecto' },
            { id: 'save', label: 'Guardar proyecto', icon: 'download', hint: 'Ctrl+S', onSelect: () => toast({ title: 'Guardado', tone: 'ok' }) },
            { id: 'open', label: 'Abrir…', icon: 'folder', description: 'Desde un archivo .pozo.json', onSelect: () => {} },
            { type: 'separator', id: 's' },
            { id: 'del', label: 'Borrar snapshot', icon: 'trash', danger: true, onSelect: () => {} },
          ]}
        />
        <Tooltip content="Tooltip accesible: aparece con el mouse o el teclado y se cierra con Escape.">
          <Button variant="ghost" icon="info">
            Pasá el mouse
          </Button>
        </Tooltip>
        <Button onClick={() => toast({ title: 'Proyecto guardado', description: 'TP.pozo.json · 412 kB', tone: 'ok' })}>Aviso</Button>
        <Button onClick={() => toast({ title: 'No se pudo abrir el proyecto', description: 'El archivo no es JSON.', tone: 'error' })} variant="danger">
          Aviso de error
        </Button>
      </Row>
      <div>
        <Tabs
          aria-label="Ejemplo de pestañas"
          idBase="sc-tabs"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'results', label: 'Resultados', icon: 'table', badge: 3 },
            { id: 'diag', label: 'Avisos', icon: 'warning', badge: 1 },
            { id: 'hist', label: 'Histograma', icon: 'histogram' },
            { id: 'xplot', label: 'Crossplot', icon: 'scatter', disabled: true },
          ]}
        />
        <TabPanel id="results" idBase="sc-tabs" active={tab === 'results'} className="showcase-tabpanel">
          Panel de resultados.
        </TabPanel>
        <TabPanel id="diag" idBase="sc-tabs" active={tab === 'diag'} className="showcase-tabpanel">
          Panel de avisos.
        </TabPanel>
        <TabPanel id="hist" idBase="sc-tabs" active={tab === 'hist'} className="showcase-tabpanel">
          Histograma (fase 7).
        </TabPanel>
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Guardar snapshot"
        description="El foco queda atrapado adentro; Escape o el fondo cierran."
        footer={
          <>
            <span className="ui-text-muted ui-text-sm">Se guarda en el proyecto.</span>
            <span style={{ flex: 1 }} />
            <Button onClick={() => setOpen(false)}>Cancelar</Button>
            <Button variant="primary" icon="check" onClick={() => setOpen(false)}>
              Guardar
            </Button>
          </>
        }
      >
        <Field label="Nombre" htmlFor="sc-name">
          <TextField id="sc-name" value="Caso base" onChange={() => {}} block data-autofocus />
        </Field>
        <Callout tone="info">Los snapshots guardan zonas, parámetros y métodos, no los datos del pozo.</Callout>
      </Dialog>
    </div>
  );
}

const TABLE_ROWS = [
  { zone: 'A', color: ZONE_PALETTE[0]!, top: 7633.26, base: 7810.5, igr: 0.412, phi: 0.182 },
  { zone: 'B', color: ZONE_PALETTE[1]!, top: 7810.5, base: 7955.04, igr: 0.268, phi: 0.214 },
  { zone: 'C', color: ZONE_PALETTE[2]!, top: 7955.04, base: 8132.4, igr: 0.551, phi: 0.097 },
  { zone: 'D', color: ZONE_PALETTE[3]!, top: 8132.4, base: 8341.6, igr: 0.189, phi: 0.243 },
];

function Palette({ theme }: { theme: ThemeName }) {
  const lines = BUILTIN_ROLES.filter((r) => CURVE_PALETTE[r.id]?.kind !== 'band');
  return (
    <div data-theme={theme} className="showcase-palette">
      <div className="showcase-palette__head">
        <strong>{theme === 'light' ? 'Claro' : 'Oscuro'}</strong>
        <span className="ui-text-muted ui-text-sm">canvas leído desde TS · fondo de pista {THEMES[theme].viewer.trackBg}</span>
      </div>
      <div className="showcase-palette__log">
        <div className="showcase-palette__heads">
          <div>
            <CurveLegend role="GR" name="GR" unit="gAPI" theme={theme} />
            <CurveLegend role="CALI" name="CALI" unit="in" theme={theme} />
          </div>
          <div className="showcase-palette__depth" />
          <div>
            <CurveLegend role="RT" name="AT90" unit="ohm·m" theme={theme} />
            <CurveLegend role="RM" name="AT30" unit="ohm·m" theme={theme} />
            <CurveLegend role="RS" name="AT10" unit="ohm·m" theme={theme} />
          </div>
          <div>
            <CurveLegend role="RHOB" name="ZDEN" unit="g/cm³" theme={theme} />
            <CurveLegend role="NPHI" name="NPHI" unit="v/v" theme={theme} />
          </div>
        </div>
        <SampleLog theme={theme} height={260} />
      </div>
      <div className="showcase-roles">
        {lines.map((r) => (
          <CurveLegend key={r.id} role={r.id} name={r.id} theme={theme} catalog={defaultRoleCatalog} />
        ))}
      </div>
      <div className="showcase-fills">
        {(Object.keys(FILL_PALETTE) as FillId[]).map((id) => (
          <div key={id} className="showcase-fill" title={FILL_PALETTE[id].label}>
            <span style={{ background: FILL_PALETTE[id][theme], opacity: Math.max(0.6, FILL_PALETTE[id].alpha) }} />
            {FILL_PALETTE[id].label}
          </div>
        ))}
      </div>
      <div className="showcase-zones">
        {ZONE_PALETTE.map((c, i) => (
          <Chip key={c} color={c}>
            Zona {String.fromCharCode(65 + i)}
          </Chip>
        ))}
        <Chip color={curveStyle('SHALE_FLAG', theme).color}>rol de módulo (respaldo)</Chip>
      </div>
    </div>
  );
}

export function DesignSystemPage() {
  return (
    <div className="showcase">
      <header className="showcase-top">
        <BrandMark />
        <div>
          <h1>Sistema de diseño</h1>
          <p className="ui-text-muted">Tokens, componentes y paleta de curvas · src/ui</p>
        </div>
        <span style={{ flex: 1 }} />
        <a className="showcase-link" href="#">
          Volver a la app
        </a>
        <ThemeToggle size="md" />
      </header>

      <main className="showcase-main">
        <Block title="Paleta de curvas por rol (claro y oscuro)" wide>
          <div className="showcase-grid2">
            <Palette theme="light" />
            <Palette theme="dark" />
          </div>
        </Block>

        <Block title="Color semántico (tema actual)" wide>
          <ColorSwatches />
        </Block>

        <Block title="Tipografía">
          <Typography />
        </Block>
        <Block title="Espaciado, radios y sombras">
          <Spacing />
        </Block>

        <Block title="Botones" wide>
          <Row label="Variantes">
            <Button variant="primary" icon="upload">
              Cargar pozo
            </Button>
            <Button icon="bookmark">Secundario</Button>
            <Button variant="ghost" icon="skip">
              Fantasma
            </Button>
            <Button variant="danger" icon="trash">
              Peligro
            </Button>
            <Button variant="primary" loading>
              Calculando
            </Button>
            <Button disabled>Desactivado</Button>
          </Row>
          <Row label="Tamaños">
            <Button size="sm" variant="primary">
              Chico
            </Button>
            <Button size="md" variant="primary">
              Mediano
            </Button>
            <Button size="lg" variant="primary" iconRight="arrow-right">
              Grande
            </Button>
            <Button size="sm">Chico</Button>
            <Button size="lg">Grande</Button>
          </Row>
          <Row label="Íconos">
            <IconButton icon="panel-left" label="Ocultar columna" />
            <IconButton icon="sliders" label="Módulos" variant="secondary" />
            <IconButton icon="eye" label="Ver" pressed />
            <IconButton icon="x" label="Cerrar" size="sm" />
            <IconButton icon="trash" label="Borrar" variant="danger" />
            <IconButton icon="play" label="Calcular" variant="primary" />
          </Row>
        </Block>

        <Block title="Controles" wide>
          <Controls />
        </Block>

        <Block title="Estados y mensajes" wide>
          <Row label="Insignias">
            {TONES.map((t) => (
              <Badge key={t} tone={t}>
                {TONE_LABEL[t]}
              </Badge>
            ))}
            {TONES.map((t) => (
              <Badge key={`o-${t}`} tone={t} variant="outline">
                {TONE_LABEL[t]}
              </Badge>
            ))}
            <Badge tone="ok" variant="solid" icon="check">
              Completo
            </Badge>
          </Row>
          <Row label="Fichas y puntos">
            <Chip color={ZONE_PALETTE[0]} selected onClick={() => {}}>
              Zona A
            </Chip>
            <Chip color={ZONE_PALETTE[1]} onClick={() => {}} onRemove={() => {}}>
              Zona B
            </Chip>
            <Chip>Sin color</Chip>
            {(['ok', 'warn', 'error', 'info', 'neutral'] as Tone[]).map((t) => (
              <span key={t} className="showcase-dot">
                <StatusDot tone={t} label={TONE_LABEL[t]} pulse={t === 'info'} /> {TONE_LABEL[t]}
              </span>
            ))}
            <span className="showcase-dot">
              <Spinner size={14} label="Cargando" /> Spinner
            </span>
          </Row>
          <div className="showcase-grid2">
            <Callout tone="info" title="Información">
              Las zonas vienen del archivo cargado.
            </Callout>
            <Callout tone="ok" title="Calidad revisada">
              12 curvas bien, 4 para revisar.
            </Callout>
            <Callout tone="warn" title="Avisos de la lectura" actions={<Button size="sm">Ver detalle</Button>}>
              CAL tiene 189 lecturas por debajo de 5 in.
            </Callout>
            <Callout tone="error" title="No se pudo abrir el proyecto">
              El archivo no es JSON.
            </Callout>
          </div>
        </Block>

        <Block title="Panel, sección y tabla" wide>
          <div className="showcase-grid2">
            <Panel title="Zonas" overline="Paso 3 de 9" actions={<IconButton icon="more" label="Más acciones" size="sm" />} flush>
              <Section title="Topes" meta="4 zonas" actions={<IconButton icon="plus" label="Agregar zona" size="sm" />}>
                <DataTable
                  dense
                  rows={TABLE_ROWS}
                  rowKey={(r) => r.zone}
                  selectedKey="B"
                  onRowClick={() => {}}
                  maxHeight={180}
                  columns={[
                    {
                      key: 'zone',
                      header: 'Zona',
                      render: (r) => (
                        <span className="showcase-zone">
                          <span style={{ background: r.color }} />
                          {r.zone}
                        </span>
                      ),
                    },
                    { key: 'top', header: 'Tope (m)', align: 'num', render: (r) => formatNumber(r.top) },
                    { key: 'base', header: 'Base (m)', align: 'num', render: (r) => formatNumber(r.base) },
                    { key: 'igr', header: 'IGR', align: 'num', render: (r) => formatNumber(r.igr, { digits: 3 }) },
                    { key: 'phi', header: 'φ', align: 'num', render: (r) => formatNumber(r.phi, { digits: 3 }) },
                  ]}
                />
              </Section>
              <Section title="Avanzado" collapsible defaultOpen={false}>
                Contenido colapsable.
              </Section>
            </Panel>
            <Panel title="Estados vacíos">
              <EmptyState
                icon="droplet"
                title="Todavía no hay métodos de porosidad"
                description="Calculá la porosidad efectiva a partir de densidad, neutrón o sónico. Cuando se agregue un módulo de este paso va a aparecer acá solo."
                actions={<Button icon="skip">Saltar este paso</Button>}
                size="sm"
              />
            </Panel>
          </div>
        </Block>

        <Block title="Diálogos, menús, pestañas y avisos" wide>
          <Overlays />
        </Block>

        <Block title={`Íconos (${ICON_NAMES.length})`} wide>
          <div className="showcase-icons">
            {ICON_NAMES.map((n) => (
              <div key={n} className="showcase-icon">
                <Icon name={n} size={20} />
                <code>{n}</code>
              </div>
            ))}
          </div>
        </Block>
      </main>
      <Toaster />
    </div>
  );
}
