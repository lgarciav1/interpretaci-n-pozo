"""F22: recálculo independiente sin importar el motor TypeScript. Defaults explícitos."""
import csv,json,re,math,bisect
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
s=open(ROOT/'src/modules/core/tpData.ts').read()
plugs=json.loads(re.search(r'export const TP_CORE_PLUGS[^=]+= (\[.*?\]);',s).group(1))
rows=list(csv.DictReader(open(ROOT/'datos/pozo_tp_perfiles.csv')))
z=[float(r['DEPTH']) for r in rows]
clip=lambda x:max(0,min(.5,x))
curves={k:[] for k in ['density','neutron','densityNeutron','densityNeutronGas','sonic']}
for r in rows:
 d=clip((2.65-float(r['ZDEN']))/1.65) if r['ZDEN'] else float('nan')
 n=clip(float(r['NPHI'])) if r['NPHI'] else float('nan')
 vals=[d,n,(d+n)/2,math.sqrt((d*d+n*n)/2),clip((float(r['DT'])-55.5)/(189-55.5)) if r['DT'] else float('nan')]
 for k,v in zip(curves,vals):curves[k].append(v)
for k,v in curves.items():
 errors=[]
 for p in plugs:
  dep=p['depthM']; j=bisect.bisect_left(z,dep)
  if j==0 or j==len(z):continue
  a,b=v[j-1],v[j]
  pred=a+(b-a)*(dep-z[j-1])/(z[j]-z[j-1])
  if math.isfinite(pred):errors.append(pred-p['phi'])
 print(k,len(errors),'rmse',math.sqrt(sum(e*e for e in errors)/len(errors)),'mae',sum(abs(e) for e in errors)/len(errors),'bias',sum(errors)/len(errors))
