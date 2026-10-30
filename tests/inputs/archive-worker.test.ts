import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../fixtures/archive/v7.pozo.json?raw';
import { ProjectFileClient, type FileWorker } from '../../src/app/projectFiles/client';
import { runProjectFileTask, type ProjectFileTask, type ProjectFileResponse } from '../../src/app/projectFiles/task';
import { deserializeProject } from '../../src/core/state/serialize';
import { projectInputState } from '../../src/core/state/inputRevisions';

class Port implements FileWorker {
  onmessage: FileWorker['onmessage'] = null;
  onerror: FileWorker['onerror'] = null;
  sent: ProjectFileTask | null = null;
  terminated = false;
  postMessage(task: ProjectFileTask) { this.sent=structuredClone(task); }
  terminate() { this.terminated=true; }
  reply(data: ProjectFileResponse) { this.onmessage?.({data:structuredClone(data)}); }
}
afterEach(()=>vi.useRealTimers());
describe('worker de archivos y frontera de publicación',()=>{
 it('transfiere copias, conserva buffers/aliases y congela metadatos recibidos',async()=>{
   const p=await deserializeProject(fixture), port=new Port(),client=new ProjectFileClient(()=>port);
   const original=p.wells[0]!.well.curves[0]!.data;
   const save=client.run({kind:'save',project:p});
   expect(port.sent!.kind).toBe('save');
   const result=await runProjectFileTask(port.sent!);port.reply({ok:true,result});
   expect((await save).kind).toBe('save');expect(port.terminated).toBe(true);
   expect(original[0]).toBe(99);expect(original.buffer.byteLength).toBe(24);
   const readPort=new Port(),readClient=new ProjectFileClient(()=>readPort),open=readClient.run({kind:'open',text:fixture});
   readPort.reply({ok:true,result:await runProjectFileTask(readPort.sent!)});
   const back=await open;if(back.kind!=='open')throw new Error('Tipo');
   expect(projectInputState(back.project)).not.toBeNull();
   expect(Object.isFrozen(back.project.inputRevisions)).toBe(true);
   expect(back.project.wells[0]!.well).toBe(back.project.inputRevisions![back.project.wells[0]!.inputRevisionId!]!.well);
 });
 it('funciona sin Worker o si el constructor falla, sin red',async()=>{
   for(const factory of [()=>null,()=>{throw new Error('no worker');}]) {
     const result=await new ProjectFileClient(factory).run({kind:'open',text:fixture});expect(result.kind).toBe('open');
   }
 });
 it('rechaza una segunda tarea concurrente y permite otra después',async()=>{
   const port=new Port(),client=new ProjectFileClient(()=>port),first=client.run({kind:'open',text:fixture});
   await expect(client.run({kind:'open',text:fixture})).rejects.toThrow(/Ya se está/);
   port.reply({ok:false,error:'Archivo corrupto'});await expect(first).rejects.toThrow(/corrupto/);
   const second=client.run({kind:'open',text:fixture});port.reply({ok:true,result:await runProjectFileTask(port.sent!)});await expect(second).resolves.toHaveProperty('kind','open');
 });
 it('un error del worker no entrega un proyecto parcial y termina la tarea',async()=>{
   const port=new Port(),client=new ProjectFileClient(()=>port),promise=client.run({kind:'open',text:fixture});
   port.onerror?.({message:'falló'});await expect(promise).rejects.toThrow(/falló/);expect(port.terminated).toBe(true);
 });
 it('el timeout termina el worker y libera la siguiente operación',async()=>{
   vi.useFakeTimers();const port=new Port(),client=new ProjectFileClient(()=>port,100),first=client.run({kind:'open',text:fixture});
   const assertion=expect(first).rejects.toThrow(/tardó demasiado/);await vi.advanceTimersByTimeAsync(100);await assertion;expect(port.terminated).toBe(true);
   const second=client.run({kind:'open',text:fixture});port.reply({ok:false,error:'x'});await expect(second).rejects.toThrow('x');
 });
 it('rechaza respuestas cruzadas o incompletas',async()=>{
   for(const response of [{ok:true,result:{kind:'save',text:'wrong'}},{ok:true,result:{kind:'open',project:null,warnings:[]}}] as unknown as ProjectFileResponse[]) {
     const port=new Port(),promise=new ProjectFileClient(()=>port).run({kind:'open',text:fixture});port.reply(response);await expect(promise).rejects.toThrow(/inválida/);
   }
 });
 it('un archivo corrupto en la alternativa en proceso tampoco se convierte en proyecto vacío',async()=>{
   await expect(new ProjectFileClient(()=>null).run({kind:'open',text:'{}'})).rejects.toThrow(/proyecto/);
 });
});
