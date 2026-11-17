/** Acción con estado de «Copiar contexto para un chat»: arma el modelo del informe y copia el texto. No envía nada. */
import { sameContext } from '../../core/engine/context';
import { copyText, toast } from '../../ui';
import { entryContext } from '../preparation/data';
import { buildReportModel } from '../report/report';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { chatContextText, type ChatContextResult } from './chatContext';

/** Texto del pozo activo; lanza un error con mensaje para la persona si no hay pozo o resultado vigente. */
export function buildActiveChatContext(): ChatContextResult {
  const project = useProject.getState().project;
  const entry = selectActiveEntry(useProject.getState());
  const state = useResults.getState();
  if (!entry) throw new Error('Cargá un pozo para copiar su contexto.');
  if (state.busy || state.error || !state.result || !sameContext(state.result.context, entryContext(entry))) throw new Error('Esperá a que termine el cálculo del pozo activo y volvé a intentar.');
  const model = buildReportModel(entry.well, entry.interpretation, state.result, new Date(), undefined,
    project.inputRevisions?.[entry.inputRevisionId ?? '']?.acquisition);
  return chatContextText(model);
}

export async function copyChatContext(): Promise<void> {
  let built: ChatContextResult;
  try { built = buildActiveChatContext(); }
  catch (e) { toast({ title: 'No se pudo copiar el contexto', description: e instanceof Error ? e.message : String(e), tone: 'error' }); return; }
  if (!(await copyText(built.text))) {
    toast({ title: 'No se pudo copiar al portapapeles', description: 'El navegador bloqueó el acceso. Probá de nuevo desde un clic del mouse.', tone: 'error' });
    return;
  }
  toast({
    title: `Contexto copiado · ${built.length.toLocaleString('es-AR')} caracteres`,
    description: `${built.truncated ? 'Se recortó para entrar en un mensaje. ' : ''}No se envió nada: pegalo vos en el chat que quieras.`,
    tone: 'ok',
  });
}
