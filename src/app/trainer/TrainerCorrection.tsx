import { useEffect, useState } from 'react';
import { Button, DataTable, Dialog, formatNumber, toast, useResolvedTheme } from '../../ui';
import { XYPlot } from '../../plots/xy/XYPlot';
import { TRAINER_PARAMETERS } from '../../petro/trainer';
import { TRAINER_ID } from '../../modules/trainer';
import { openEquations } from '../ecuaciones/open';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { trainerCorrection } from './correction';

const VARIABLES = [
  { key: 'phi', label: 'Porosidad efectiva φ', max: 0.5 },
  { key: 'vsh', label: 'Volumen de arcilla Vsh', max: 1 },
  { key: 'sw', label: 'Saturación de agua Sw', max: 1 },
] as const;

export function TrainerCorrection() {
  const entry = useProject(selectActiveEntry);
  const { result, busy, error } = useResults();
  const theme = useResolvedTheme();
  const [revealed, setRevealed] = useState<{
    project: ReturnType<typeof useProject.getState>['project'];
    result: NonNullable<typeof result>;
    data: ReturnType<typeof trainerCorrection>;
  } | null>(null);
  const project = useProject(s => s.project);
  const data = revealed?.project === project && revealed.result === result ? revealed.data : null;
  useEffect(() => {
    if (revealed && !data) setRevealed(null);
  }, [revealed, data]);

  const recipe = entry?.trainerRecipe;
  if (!recipe) return null;

  const close = () => setRevealed(null);
  const label = `Semilla ${recipe.seed} · ${recipe.noise ? 'Con ruido' : 'Sin ruido'} · Versión ${recipe.version}`;
  const estimated = theme === 'dark' ? '#60a5fa' : '#1d4ed8';
  const truth = theme === 'dark' ? '#fbbf24' : '#9a4b0a';
  const p = TRAINER_PARAMETERS;
  const fmt = (v: number | null) => formatNumber(v, { digits: 3 });

  return <>
    <Button icon="check-circle" title={`Corregir ejercicio · ${label}`} onClick={() => {
      if (!result) return;
      try {
        setRevealed({ project, result, data: trainerCorrection(project, entry, result) });
      } catch (failure) {
        toast({ title: 'No se pudo corregir el ejercicio', description: (failure as Error).message, tone: 'error' });
      }
    }} disabled={!result || busy || !!error}>Corregir ejercicio</Button>
    <Dialog open={!!data} onClose={close} title="Corrección del entrenador" description={label} size="xl" className="trainer-correction"
      footer={<><Button onClick={() => { close(); openEquations(TRAINER_ID); }}>Ver Ecuaciones</Button><Button variant="primary" onClick={close}>Volver al pozo</Button></>}>
      {data && <>
        <div className="trainer-key" aria-label="Leyenda de la corrección">
          <span style={{ color: estimated }}>━ Interpretación activa</span>
          <span style={{ color: truth }}>┄ Verdad sembrada</span>
        </div>
        <div className="trainer-plots">
          {VARIABLES.map(({ key, label: variable, max }) => {
            const calculated = data[key];
            return <section key={key} aria-label={variable}>
              <h3>{variable}</h3>
              <p>{calculated?.name ?? 'Sin fuente activa disponible'}</p>
              <XYPlot
                ariaLabel={`${variable} contra profundidad medida`}
                height={148}
                x={{ kind: 'linear', min: 0, max, label: variable, unit: 'v/v' }}
                y={{ kind: 'linear', min: data.depth[0]!, max: data.depth[data.depth.length - 1]!, reversed: true, label: 'MD', unit: 'm' }}
                lines={[
                  ...(calculated ? [{ id: 'estimated', x: calculated.values, y: data.depth, color: estimated, width: 2.5 }] : []),
                  { id: 'truth', x: data.truth[key], y: data.depth, color: truth, dash: [4, 3] },
                ]}
              />
            </section>;
          })}
        </div>
        <div className="trainer-table">
          <DataTable
            dense
            caption="Errores por zona · MAE y RMSE en puntos porcentuales (p.p.)"
            rowKey={row => row.id}
            rows={data.metrics.flatMap(row => (['phi', 'sw'] as const).map(key => {
              const metric = row[key];
              const zone = row.zoneId === null ? 'Fuera de zona' : entry.interpretation.zones.find(z => z.id === row.zoneId)?.name ?? row.zoneId;
              return {
                id: JSON.stringify([row.zoneId, key]),
                zone,
                variable: key === 'phi' ? 'φ efectiva' : 'Sw',
                mae: fmt(metric.mae),
                rmse: fmt(metric.rmse),
                pairs: `${metric.valid} / ${metric.total}`,
                coverage: `${formatNumber(metric.coverage, { digits: 1 })} %`,
              };
            }))}
            columns={[
              { key: 'zone', header: 'Zona' },
              { key: 'variable', header: 'Variable' },
              { key: 'mae', header: 'MAE', align: 'num' },
              { key: 'rmse', header: 'RMSE', align: 'num' },
              { key: 'pairs', header: 'Pares válidos / muestras', align: 'num' },
              { key: 'coverage', header: 'Cobertura', align: 'num' },
            ]}
          />
        </div>
        <details className="trainer-conditions">
          <summary>Condiciones de generación</summary>
          <p>GR de arena limpia y arcilla {p.grClean} y {p.grShale} gAPI. Densidades de matriz y fluido {fmt(p.rhoMatrix)} y {fmt(p.rhoFluid)} g/cm³. Rw {fmt(p.rw)} Ω·m a temperatura de formación. Archie con a {p.a}, m {p.m} y n {p.n}, sin conducción de arcilla.</p>
          <p>{recipe.noise ? 'Ruido uniforme centrado. Límites de perturbación en GR ±0,34 gAPI, densidad ±0,0033 g/cm³, neutrón ±0,002 v/v y logaritmo natural de Rt ±0,02 (adimensional).' : 'Sin perturbaciones de medición.'}</p>
        </details>
      </>}
    </Dialog>
  </>;
}

