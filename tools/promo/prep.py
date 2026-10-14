import csv, json, math, os
import numpy as np
rows = list(csv.DictReader(open(os.path.join(os.path.dirname(__file__), '..', '..', 'datos', 'pozo_tp_perfiles.csv'))))
def col(k):
    out=[]
    for r in rows:
        v=r[k]; out.append(float(v) if v not in ('',None) else None)
    return out
d = col('DEPTH')
data = {'depth': d[::2]}
for k in ['GR','AT90','AT10','ZDEN','NPHI','DT','PE','CAL']:
    data[k] = [None if v is None else round(v,4) for v in col(k)[::2]]
data['zone'] = [r['ZONA'] for r in rows][::2]
# trend DT vs depth
dt = np.array([np.nan if v is None else v for v in col('DT')]); z = np.array(d)
m = ~np.isnan(dt)
zz, yy = z[m], dt[m]
fits = {}
def r2(y, yh): return 1 - np.sum((y-yh)**2)/np.sum((y-y.mean())**2)
a,b = np.polyfit(zz,yy,1); fits['lin']=dict(a=a,b=b,r2=r2(yy,a*zz+b))
a,b = np.polyfit(np.log(zz),yy,1); fits['log']=dict(a=a,b=b,r2=r2(yy,a*np.log(zz)+b))
a,b = np.polyfit(zz,np.log(yy),1); fits['exp']=dict(a=a,b=b,r2=r2(yy,np.exp(b)*np.exp(a*zz)))
a,b = np.polyfit(np.log(zz),np.log(yy),1); fits['pow']=dict(a=a,b=b,r2=r2(yy,np.exp(b)*zz**a))
print(fits)
for k in ['GR','AT90','ZDEN','NPHI','DT']:
    v=np.array([x for x in data[k] if x is not None]); print(k, v.min(), np.percentile(v,[1,50,99]), v.max())
open(os.path.join(os.path.dirname(__file__), 'data.js'),'w').write('window.WELL='+json.dumps(data, separators=(',',':'))+';')
