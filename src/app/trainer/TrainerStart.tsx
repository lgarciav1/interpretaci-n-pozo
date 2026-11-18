import { useState } from 'react';
import { Button, Dialog } from '../../ui';
import { closeHome } from '../home/actions';
import { startTrainer } from './actions';
import './trainer.css';

export function TrainerStart({ disabled }: { disabled: boolean }) {
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
        <label>
          Semilla (opcional)
          <input data-autofocus inputMode="numeric" value={seedText} onChange={event => setSeedText(event.target.value)} placeholder="Aleatoria" aria-invalid={!valid} />
        </label>
        <small>Usá un entero entre 0 y 4.294.967.295 para repetir un ejercicio.</small>
        <label className="trainer-start__noise"><input type="checkbox" checked={noise} onChange={event => setNoise(event.target.checked)} /> Con ruido de medición</label>
        <Button type="submit" variant="primary" disabled={!valid}>Iniciar ejercicio</Button>
      </form>
    </Dialog>
  </>;
}
