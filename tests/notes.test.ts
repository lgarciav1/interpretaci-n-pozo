import { enableProjectInputRevisions } from '../src/core/state/inputRevisions';
import { describe, expect, it } from 'vitest';
import { syntheticWell } from '../src/app/demo/syntheticWell';
import { sameEngineInputs } from '../src/core/interpretation';
import { sanitizeNotes } from '../src/core/notes';
import { addWell, createProject, getWellEntry } from '../src/core/state/project';
import { saveNote, moveNote, removeNote } from '../src/core/state/notes';
import { serializeProject, deserializeProject } from '../src/core/state/serialize';
import { createSnapshot, restoreSnapshot } from '../src/core/state/snapshots';
import { emptyHistory, recordChange, undo, redo } from '../src/core/state/history';
import { buildReportModel, reportHtml, defaultReportOptions } from '../src/app/report/report';
const demo = syntheticWell(), w = demo.well.id;
const base = () => addWell(createProject('Notas'), demo.well, demo.zones);
const notes = (p: ReturnType<typeof base>) => getWellEntry(p, w).interpretation.notes;
const n = { id: 'n', text: '<script>roca</script>\nSegunda línea', top: demo.well.depth.values[10]!, base: demo.well.depth.values[20]! };
describe('notas de profundidad', () => {
  it('crea, edita, mueve y borra sin cambiar entradas del motor; respeta los límites manteniendo espesor', () => {
    const p0 = base(), p1 = saveNote(p0, w, n);
    expect(sameEngineInputs(getWellEntry(p0,w).interpretation,getWellEntry(p1,w).interpretation)).toBe(true);
    expect(saveNote(p1,w,n)).toBe(p1);
    const moved = notes(moveNote(p1,w,'n',-1e6))![0]!;
    expect(moved.top).toBe(demo.well.depth.values[0]);
    expect(moved.base! - moved.top).toBeCloseTo(n.base - n.top);
    expect(notes(saveNote(p1,w,{...n,text:'Editada'}))![0]!.text).toBe('Editada');
    expect(notes(removeNote(p1,w,'n'))).toEqual([]);
    expect(() => saveNote(p0,w,{...n,top:NaN})).toThrow();
    expect(() => saveNote(p0,w,{...n,base:n.top-1})).toThrow();
    expect(() => saveNote(p0,w,{...n,text:' '})).toThrow();
    expect(() => saveNote(p0,w,{...n,top:-1})).toThrow();
  });
  it('deshacer/rehacer restaura la nota y snapshots conservan el texto', () => {
    const p0=base(),p1=saveNote(p0,w,n),h=recordChange(emptyHistory(),p0,'Guardar nota',1000);
    const u=undo(h,p1)!; expect(notes(u.project)).toBeUndefined();
    expect(notes(redo(u.history,u.project)!.project)).toEqual([n]);
    const s=createSnapshot(p1,w,'Anotado');
    expect(notes(restoreSnapshot(removeNote(s.project,w,'n'),s.snapshot.id))).toEqual([n]);
  });
  it('reabre proyecto y snapshot en v6/v7; los archivos anteriores siguen sin notas', async () => {
    for (const version of [6,7] as const) {
      const p=createSnapshot(saveNote(base(),w,n),w,'Nota').project;
      const back=await deserializeProject(await serializeProject(version === 7 ? enableProjectInputRevisions(p) : p,{version,codec:'f64le-b64'}));
      expect(notes(back)).toEqual([n]); expect(back.snapshots[0]!.interpretation.notes).toEqual([n]);
      expect(notes(await deserializeProject(await serializeProject(version === 7 ? enableProjectInputRevisions(base()) : base(),{version,codec:'f64le-b64'})))).toBeUndefined();
    }
  });
  it('rechaza notas corruptas o duplicadas y escapa texto en el informe', () => {
    const warnings:string[]=[];
    expect(sanitizeNotes([n,n,{...n,id:'bad',top:Infinity}],'test',m=>warnings.push(m))).toEqual([n]);
    expect(warnings).toHaveLength(2);
    const i=getWellEntry(saveNote(base(),w,n),w).interpretation;
    const html=reportHtml(buildReportModel(demo.well,i,null),[],defaultReportOptions());
    expect(html).toContain('Notas de profundidad'); expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>roca');
  });
});
