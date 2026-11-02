/**
 * Acción de la paleta (Ctrl+K) «Abrir Log Digitizer» (docs/decisiones/0063). Se descubre sola
 * (`src/modules/<id>/commands.ts`). Siempre habilitada: sin pozo se puede crear uno nuevo desde la imagen.
 * La columna «Datos del pozo» la ejecuta por su id (sin importar este módulo).
 */
import type { CommandSource } from '../../ui';
import { openDigitizerDesk } from './store';

export const DIGITIZER_COMMAND_ID = 'digitizer:open';

export const commands: CommandSource = () => [
  {
    id: DIGITIZER_COMMAND_ID,
    title: 'Abrir Log Digitizer',
    group: 'Pozo',
    detail: 'digitalizar un registro escaneado',
    keywords: ['digitalizar', 'digitalizador', 'digitizer', 'escaneado', 'escanear', 'imagen', 'scan', 'raster', 'papel', 'trazar', 'curva', 'importar'],
    icon: 'pen',
    run: openDigitizerDesk,
  },
];
