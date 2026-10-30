/** El worker de archivos es independiente de los motores petrofísico y de snapshots. */
import ArchiveWorker from './archive.worker?worker&inline';
import { ProjectFileClient, type FileWorker } from './client';
export const projectFiles = new ProjectFileClient(() => typeof Worker === 'undefined' ? null : new ArchiveWorker({ name: 'archivos-proyecto' }) as unknown as FileWorker);
