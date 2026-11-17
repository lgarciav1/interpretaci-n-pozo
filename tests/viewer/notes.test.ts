import { expect, it } from 'vitest';
import { syntheticWell } from '../../src/app/demo/syntheticWell';
import { emptyInterpretation } from '../../src/core/interpretation';
import type { DepthNote } from '../../src/core/notes';
import { THEMES } from '../../src/ui/tokens';
import type { OverlayFrame } from '../../src/viewer/overlay';
import { createNotesOverlay } from '../../src/viewer/overlays/notes';
function frame(notes: DepthNote[], height: number) {
  const rects: {x:number;y:number;width:number;height:number}[] = [];
  const texts: {text:string;x:number;y:number}[] = [];
  const ctx = { save() {}, restore() {}, setLineDash() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, strokeRect() {},
    fillRect(x:number,y:number,width:number,height:number) { rects.push({x,y,width,height}); },
    fillText(text:string,x:number,y:number) { texts.push({text,x,y}); }, measureText: (s:string) => ({width:s.length*6}),
  } as unknown as CanvasRenderingContext2D;
  const {well} = syntheticWell();
  const f: OverlayFrame = {ctx,theme:THEMES.light,viewport:{top:0,base:100,height,pxPerM:height/100,yOf:d=>d*height/100,depthOf:y=>y*100/height},tracks:[],
    data:{wellId:well.id,well,depth:well.depth.values,zones:[],selectedZoneId:null,qc:null,computed:[],interpretation:{...emptyInterpretation(),notes}},invalidate() {}};
  return {f,rects,texts};
}
const notes = [{id:'deep',top:95,text:'Deep'},{id:'shallow',top:90,text:'Shallow'}];
it('redistribuye rótulos del borde inferior sin superponerlos cuando caben y conserva su hit',()=>{
  const {f,rects}=frame(notes,100),overlay=createNotesOverlay(); overlay.draw(f);
  expect(rects).toHaveLength(2);
  expect(rects[0]!.y).toBeGreaterThanOrEqual(0);
  expect(rects[0]!.y+rects[0]!.height).toBeLessThan(rects[1]!.y);
  expect(rects[1]!.y+rects[1]!.height).toBeLessThanOrEqual(100);
  expect(overlay.hit!(f,{x:20,y:70,depth:70,track:null})!.key).toBe('deep');
});
it('si no caben, el hit sigue el orden de pintura y no el de inserción',()=>{
  const {f}=frame(notes,50),overlay=createNotesOverlay();overlay.draw(f);
  expect(overlay.hit!(f,{x:20,y:20,depth:40,track:null})!.key).toBe('deep');
});
it('el encabezado de profundidad queda dentro de la caja aunque el cuerpo sea corto',()=>{
  const {f,rects,texts}=frame([{id:'a',top:90,text:'A'}],100),overlay=createNotesOverlay();overlay.draw(f);
  const box=rects[0]!;
  for(const text of texts) expect(text.x+text.text.length*6).toBeLessThanOrEqual(box.x+box.width-6);
});
