import { expect, it } from 'vitest';
import { SvgContext2D, withSvgPath2D } from '../../src/io/export/figures';
import { drawViewerFigure, layoutViewerFigure } from '../../src/viewer/figure';
import { buildViewerFigure } from '../../src/viewer/figureInput';
import { createNotesOverlay } from '../../src/viewer/overlays/notes';
import { tpFigureContext, tpRequest } from './support';
import { checkXml } from './xml';
it('exporta notas por punto y tramo en el mismo cuerpo SVG del perfil, con texto completo y escapado', () => {
  const context = tpFigureContext();
  context.data = { ...context.data, interpretation: { ...context.data.interpretation, notes: [{id:'a',top:7900,text:'Arena <limpia> & corona'}, {id:'b',top:7950,base:7975,text:'Derrumbe\nComparar neutrón'}] } };
  context.overlays = [...context.overlays, createNotesOverlay()];
  const input=buildViewerFigure(tpRequest(),context),layout=layoutViewerFigure(input);
  const c=new SvgContext2D({width:layout.width,height:layout.height,measure:input.measure,title:input.title});
  withSvgPath2D(()=>drawViewerFigure(c.asCanvas(),input,layout));
  const svg=c.toSvg('#ffffff'),xml=checkXml(svg);
  expect(xml.root).toBe('svg');expect(svg).toContain('Arena &lt;limpia&gt; &amp; corona');expect(svg).toContain('Comparar neutrón');expect(svg).toContain('7950.00–7975.00 m MD');expect(svg).not.toMatch(/NaN|Infinity/);
});
