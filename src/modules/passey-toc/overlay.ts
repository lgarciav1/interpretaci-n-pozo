/** Pistas nativas autodescubiertas: coordenadas alineadas del mismo motor, TOC y bandera. */
import type { ViewerOverlay } from '../../viewer/overlay';
import { formatNumber } from '../../ui/format';

const canRead=(well:{curves:readonly {role?:string|null}[]})=>['RT','DT'].every(role=>well.curves.some(c=>c.role===role));
const scale={kind:'linear' as const,min:-2,max:2};
export const overlays:ViewerOverlay[]=[{
  id:'passey-separation',label:'Superposición Passey · 50 µs/ft por ciclo',layer:'over',
  track:{title:'Passey · ciclos',scale,unit:'unitless',width:1.1,after:'sonic',workspaces:['geology'],
    spec:{id:'passey-separation',title:'Passey · ciclos',kind:'curves',width:1.1,scale,
      curves:[{select:{role:'PASSEY_DT_OVERLAY'},style:{color:'#1f5fd1',min:-2,max:2,scale:'linear'}},{select:{role:'PASSEY_RT_OVERLAY'},style:{color:'#c81e3a',min:-2,max:2,scale:'linear'}}],
      fills:[{kind:'between',a:'PASSEY_RT_OVERLAY',b:'PASSEY_DT_OVERLAY',bLeft:'#bd6fa7',compare:'value',opacity:.45}],emptyHint:'Sin resistividad, sónico o línea base válida.'},
    resolve({well}){return canRead(well)?{title:'Passey · ciclos',scale,unit:'unitless'}:null;}},
  draw(){},
  hit({data},p){
    if(p.track?.id!=='ov:passey-separation' && !p.track?.hasRole('PASSEY_RT_OVERLAY'))return null;
    let best=0,dist=Infinity; for(let i=0;i<data.depth.length;i++){const d=Math.abs(data.depth[i]-p.depth);if(d<dist){dist=d;best=i;}}
    const delta=data.computed.find(c=>c.port==='DELTA_LOG_R'&&c.active)?.data[best];
    const toc=data.computed.find(c=>c.port==='TOC'&&c.active)?.data[best];
    return {label:`Separación Passey: ${formatNumber(delta,{digits:3})} ciclos\nTOC: ${formatNumber(toc,{digits:2})} % peso\n50 µs/ft por ciclo. Línea base y LOM configurados; resultado orientativo.`,cursor:'default'};
  },
},{
  id:'passey-toc-profile',label:'TOC · Passey',layer:'over',
  track:{title:'TOC',scale:{kind:'linear',min:0,max:20},unit:'wt%',width:.8,after:'passey-separation',workspaces:['geology'],
    spec:{id:'passey-toc-profile',title:'TOC',kind:'curves',width:.8,scale:{kind:'linear',min:0,max:20},curves:[{select:{role:'TOC'}}],fills:[{kind:'edge',curve:'TOC',side:'left',fill:'#6c934e',opacity:.4}],emptyHint:'Sin estimación TOC válida.'},
    resolve({well}){return canRead(well)?{title:'TOC',scale:{kind:'linear',min:0,max:20},unit:'wt%'}:null;}},draw(){},
},{
  id:'passey-source-flag',label:'Posible roca generadora',layer:'over',
  track:{title:'Generadora',scale:{kind:'linear',min:0,max:1},unit:'unitless',width:.3,after:'passey-toc-profile',workspaces:['geology'],
    spec:{id:'passey-source-flag',title:'Generadora',kind:'flags',width:.3,curves:[{select:{role:'IND_SOURCE_ROCK'}}],emptyHint:'Sin bandera válida.'},
    resolve({well}){return canRead(well)?{title:'Generadora',scale:{kind:'linear',min:0,max:1},unit:'unitless'}:null;}},draw(){},
}];
