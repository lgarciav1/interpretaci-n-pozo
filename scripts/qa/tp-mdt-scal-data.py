"""Genera src/modules/mdt/tpData.ts y src/modules/swi-pc/tpScal.ts desde el Excel de la cátedra.
Uso: python3 scripts/qa/tp-mdt-scal-data.py TP_interpretacion_de_Pozo.xlsx   (hojas MDT y SCAL)."""
import sys, json, openpyxl
wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
num = lambda v: isinstance(v, (int, float))
js = lambda o: json.dumps(o, ensure_ascii=False, separators=(',', ':'))
mdt = [dict(zone=r[3], depthM=round(r[1], 4), pressurePsi=round(r[2], 3), drawdown=round(r[0], 3))
       for r in wb['MDT'].iter_rows(min_row=2, values_only=True) if num(r[1]) and num(r[2]) and r[3]]
sc = wb['SCAL']
disp = [dict(sample=str(r[2]), rootRaw=round(r[3], 5), displacementKgCm2=round(r[4], 5))
        for r in sc.iter_rows(min_row=68, max_row=75, values_only=True) if r[2]]
thr = [dict(sample=str(r[4]), kGasMd=round(r[5], 4), phiPct=round(r[6], 4), rootKPhi=round(r[7], 5))
       for r in sc.iter_rows(min_row=92, max_row=99, values_only=True) if r[4]]
open('src/modules/mdt/tpData.ts', 'w', encoding='utf8').write(f'''/**
 * Presiones de formación MDT del TP (hoja MDT del Excel de la cátedra). GENERADO por scripts/qa/tp-mdt-scal-data.py:
 * no editar a mano. {len(mdt)} puntos de las zonas B, C y D: profundidad (m), presión de formación (psi), caída de
 * presión de la prueba (drawdown) y zona.
 */
export interface TpMdtPoint {{
  zone: string;
  depthM: number;
  pressurePsi: number;
  drawdown: number;
}}
export const TP_MDT_POINTS: readonly TpMdtPoint[] = {js(mdt)};
''')
open('src/modules/swi-pc/tpScal.ts', 'w', encoding='utf8').write(f'''/**
 * Datos SCAL del TP (hoja SCAL del Excel de la cátedra). GENERADO por scripts/qa/tp-mdt-scal-data.py: no editar a mano.
 * - `TP_SCAL_DISPLACEMENT`: presión de desplazamiento (kg/cm²) de {len(disp)} muestras. `rootRaw` es la columna «RAIZ» de la
 *   hoja, que vale 10 veces √(k/φ%) (usa φ en fracción): no es comparable con `rootKPhi` de la tabla de garganta poral.
 * - `TP_SCAL_THROAT`: las mismas {len(thr)} muestras con k de gas (mD), φ (%) y √(k/φ%) de la tabla «diámetro de garganta
 *   poral» de la hoja.
 */
export const TP_SCAL_DISPLACEMENT: readonly {{ sample: string; rootRaw: number; displacementKgCm2: number }}[] = {js(disp)};
export const TP_SCAL_THROAT: readonly {{ sample: string; kGasMd: number; phiPct: number; rootKPhi: number }}[] = {js(thr)};
''')
print(len(mdt), len(disp), len(thr))
