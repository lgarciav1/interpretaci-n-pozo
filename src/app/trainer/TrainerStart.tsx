import { useId, useState } from 'react';
import { Button, Checkbox, Dialog, Field, TextField } from '../../ui';
import { closeHome } from '../home/actions';
import { startTrainer } from './actions';
import './trainer.css';

export function TrainerStart({ disabled }: { disabled: boolean }) {
  const seedId = useId();
  const [open, setOpen] = useState(false);
  const [seedText, setSeedText] = useState('');
  const [noise, setNoise] = useState(true);
  const seed = seedText === '' ? undefined : Number(seedText);
  const valid = seed === undefined || (/^\d+$/.test(seedText) && seed <= 0xffffffff);

  return <>
    <Button variant="ghost" onClick={() => setOpen(true)} disabled={disabled}>Entrenador</Button>
    <Dialog open={open} onClose={() => setOpen(false)} title="Entrenador" size="sm">
      <form className="trainer-start" onSubmit={event => {
        event.preventDefault();
        if (!valid) return;
        startTrainer({ version: 1, seed: seed ?? crypto.getRandomValues(new Uint32Array(1))[0]!, noise });
        closeHome();
      }}>
        <Field label="Semilla (opcional)" htmlFor={seedId} hint="Usá un entero entre 0 y 4.294.967.295 para repetir un ejercicio." error={!valid ? 'Ingresá un entero válido.' : undefined}>
          <TextField id={seedId} data-autofocus inputMode="numeric" value={seedText} onChange={setSeedText} placeholder="Aleatoria" invalid={!valid} block />
        </Field>
        <Checkbox checked={noise} onChange={setNoise} label="Con ruido de medición" />
        <Button type="submit" variant="primary" disabled={!valid}>Iniciar ejercicio</Button>
      </form>
    </Dialog>
  </>;
}

