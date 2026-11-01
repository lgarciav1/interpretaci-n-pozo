import openpyxl, json
p='TP_interpretacion_de_Pozo.xlsx'
wb=openpyxl.load_workbook(p,read_only=True,data_only=True)
num=lambda v:isinstance(v,(int,float))
rows=list(wb['PB'].iter_rows(min_row=7,max_row=114,values_only=True))
# la hoja tiene 108 filas de datos como máximo; leer hasta el final real
rows=list(wb['PB'].iter_rows(min_row=7,values_only=True))
ffs=[(r[0],r[2],r[4],r[6]) for r in wb['FF Summary'].iter_rows(min_row=16,max_row=27,values_only=True)]
plugs=[]
for run,cols in (('1',(0,2,4,5,6)),('2',(11,13,15,16,17))):
    ia,im,iphi,ik,ig=cols
    n=0
    for r in rows:
        if len(r)>ig and num(r[ia]) and num(r[im]) and num(r[iphi]) and num(r[ik]) and num(r[ig]):
            n+=1
            plugs.append(dict(run=run,id=f'C{run}-{n:02d}',depthFt=round(r[ia],2),depthM=round(r[im],4),phi=round(r[iphi],5),kMd=round(r[ik],5),rhog=round(r[ig],4),ff=None))
# cada muestra de FF se asigna a UN plug: profundidad original igual (±0,01 ft) y, entre empates, porosidad más cercana
for sid,dft,phi,F in ffs:
    cand=[q for q in plugs if abs(q['depthFt']-dft)<=0.011]
    assert cand, ('sin plug para',sid,dft)
    q=min(cand,key=lambda c:abs(c['phi']-phi)); assert q['ff'] is None,('plug ya asignado',sid)
    q['ff']=round(F,4); q['id']=sid
print(len(plugs),sum(1 for q in plugs if q['ff']),'con F; por corona',{r:sum(1 for q in plugs if q['run']==r) for r in '12'})
ri_pts=[[round(r[1],5),round(r[0],5)] for r in wb['IRSummary'].iter_rows(min_row=18,max_row=609,min_col=17,max_col=18,values_only=True) if num(r[0]) and num(r[1]) and r[0]>0 and 0<r[1]<=1]
ri_plug=[dict(id=r[0],sw=round(r[5],5),ri=round(r[4],5)) for r in wb['IRSummary'].iter_rows(min_row=17,max_row=28,values_only=True)]
print(len(ri_pts),len(ri_plug))
def js(o): return json.dumps(o,ensure_ascii=False,separators=(',',':'))
out=f'''/**
 * Datos de laboratorio de corona del TP (Excel de la cátedra «TP_interpretacion_de_Pozo.xlsx»), embebidos en la app.
 * GENERADO por scripts/qa/tp-lab-data.py a partir de las hojas PB, FF Summary e IRSummary. No editar a mano.
 *
 * - `TP_CORE_PLUGS`: {len(plugs)} plugs de dos coronas (hoja PB). `depthM` es la columna «Sample Depth, m» del Excel, que ya
 *   está corrida entre 4,2 y 4,9 m respecto de la profundidad original del laboratorio (`depthFt`, la que usan las hojas
 *   FF e IR para identificar muestras). `ff` es el factor de formación de la hoja FF Summary para los 12 plugs medidos.
 * - `TP_RI_COMPOSITE`: pares [Sw, RI] compuestos de la hoja IRSummary (todos los plugs, sin identificar).
 * - `TP_RI_PLUGS`: el punto final de desaturación [Sw, RI] de cada uno de los 12 plugs de la hoja IRSummary.
 */
export interface TpCorePlug {{
  run: '1' | '2';
  id: string;
  depthFt: number;
  depthM: number;
  phi: number;
  kMd: number;
  rhog: number;
  ff: number | null;
}}
export const TP_CORE_PLUGS: readonly TpCorePlug[] = {js(plugs)};
export const TP_RI_COMPOSITE: readonly (readonly [sw: number, ri: number])[] = {js(ri_pts)};
export const TP_RI_PLUGS: readonly {{ id: string; sw: number; ri: number }}[] = {js(ri_plug)};
'''
import os
open('src/modules/core/tpData.ts','w',encoding='utf8').write(out)
print(os.path.getsize('src/modules/core/tpData.ts'),'bytes')
