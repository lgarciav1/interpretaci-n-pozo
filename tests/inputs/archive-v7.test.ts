import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../fixtures/archive/v7.pozo.json?raw';
import { sha256, sha256Fallback } from '../../src/core/state/archive/sha256';
import { archiveLimits, checkFileSize, DecodeBudget } from '../../src/core/state/archive/limits';
import { float64Bytes } from '../../src/core/state/archive/arrayCodec';
import { deserializeProject, serializeProject, recoverProject, decodeArray, encodeArray, type CodecChoice } from '../../src/core/state/serialize';
import { enableProjectInputRevisions, projectInputState, resolveSnapshotInputs, reviseProjectInputs } from '../../src/core/state/inputRevisions';
import { createProject, addWell, getWellEntry, updateWell, type Project } from '../../src/core/state/project';
import { restoreSnapshot } from '../../src/core/state/snapshots';
import { createWell } from '../../src/core/well';
import { createPointSet } from '../../src/core/pointSets';
import { snapshotRunRequest } from '../../src/app/snapshots/request';
import { computeOnce } from '../../src/core/engine/engine';
import { createRegistry } from '../../src/core/registry';
import { linearModule } from '../helpers';

const nativeHash = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), n=>n.toString(16).padStart(2,'0')).join('');
const date = '2026-10-29T00:00:00.000Z';
const rootId = 'input-' + '1'.padStart(32,'0');
const childId = 'input-' + '2'.padStart(32,'0');
const parse = () => JSON.parse(fixture);
const active = (p: Project) => getWellEntry(p, 'w');
const bits = (a: Float64Array) => [...float64Bytes(a)];
const json = (raw: unknown) => JSON.stringify(raw);
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('v7 independiente y recuperación de snapshots', () => {
  it('lee el fixture externo, conserva aliases/datos compartidos y restaura laboratorio, curva y decisiones', async () => {
    const p = await deserializeProject(fixture);
    expect(active(p).well.curves[0]!.data[0]).toBe(99);
    expect(active(p).well).toBe(p.inputRevisions![childId]!.well);
    expect(active(p).well.depth.values).toBe(p.inputRevisions![rootId]!.well.depth.values);
    expect(Object.isFrozen(p.inputRevisions![rootId]!.well.header)).toBe(true);
    const restored = restoreSnapshot(p,'before');
    expect(active(restored).inputRevisionId).toBe(rootId);
    expect(active(restored).well.curves[0]!.data[0]).toBe(10);
    expect(active(restored).well.pointSets[0]!.columns.phi!.values[0]).toBe(0.25);
    expect(active(restored).well.pointSets[0]!.columns.fluid!.values).toEqual(['oil']);
    expect(active(restored).interpretation.pointSets.core!.depthShift).toBe(0.5);
    expect(active(restored).progress).toEqual(active(p).progress);
    expect(restored.display).toBe(p.display);
  });
  it.each<CodecChoice>(['f64le-b64','f64le-deflate-b64','f64le-shuffle-deflate-b64','auto'])('cierra/reabre en %s y vuelve a guardar sin cambiar ids ni los bytes', async (codec) => {
    const p = await deserializeProject(fixture);
    const text = await serializeProject(p,{codec,savedAt:date});
    const raw = JSON.parse(text);
    expect(raw.version).toBe(7);
    expect(raw.project.wells[0]).not.toHaveProperty('well');
    expect(Object.keys(raw.project.inputRevisions)).toEqual([rootId,childId]);
    const back = await deserializeProject(text);
    expect(back).toEqual(p);
    expect(await serializeProject(back,{codec,savedAt:date})).toBe(text);
    expect(active(restoreSnapshot(back,'before')).well).toBe(back.inputRevisions![rootId]!.well);
  });
  it('crea una hija después de reabrir y conserva los snapshots originales al guardar otra vez', async () => {
    const p = await deserializeProject(fixture);
    const changed = updateWell(p,'w',d => { d.curves[0]!.data[1]=88; return d; });
    const back = await deserializeProject(await serializeProject(changed));
    expect(Object.keys(back.inputRevisions!)).toHaveLength(3);
    expect(active(back).well.curves[0]!.data[1]).toBe(88);
    expect(active(restoreSnapshot(back,'before')).well.curves[0]!.data[1]).toBe(20);
    expect(active(p).well.curves[0]!.data[1]).toBe(20);
  });
  it('después de cerrar/abrir el runner resuelve y calcula el GR histórico, sin cambiar el activo', async () => {
    const p = await deserializeProject(await serializeProject(await deserializeProject(fixture)));
    const request = snapshotRunRequest(p,p.snapshots[0]!);
    const registry = createRegistry([linearModule('gr','GR','VSH')]);
    const result = computeOnce(registry,request.engineWell,request.interpretation);
    expect((result.outputs.find(o => o.port === 'VSH')!.value as Float64Array)[0]).toBe(10);
    expect(active(p).well.curves[0]!.data[0]).toBe(99);
  });
  it('no duplica binario por editar solo adquisición; se comparten los arrays al reabrir', async () => {
    const p = await deserializeProject(fixture);
    const r = p.inputRevisions![childId]!;
    const changed = reviseProjectInputs(p,'w',{acquisition:{...r.acquisition,depth:{kind:'MD',datum:'KB'}}});
    const a=JSON.parse(await serializeProject(p)), b=JSON.parse(await serializeProject(changed));
    expect(b.project.blobs).toEqual(a.project.blobs);
    const back = await deserializeProject(JSON.stringify(b));
    expect(active(back).well.curves[0]!.data).toBe(back.inputRevisions![childId]!.well.curves[0]!.data);
  });
  it('conserva payloads NaN, infinitos, ceros con signo y subarrays exactamente en los tres codecs', async () => {
    const words = new BigUint64Array([0x3ff0000000000000n,0x7ff8000000001234n,0x8000000000000000n,0x7ff0000000000000n,0xfff0000000000000n]);
    const values=new Float64Array(words.buffer).subarray(1,4);
    let p=await deserializeProject(fixture);
    p=updateWell(p,'w',d=>{d.curves[0]!.data=values;return d;});
    for (const codec of ['f64le-b64','f64le-deflate-b64','f64le-shuffle-deflate-b64'] as const) {
      const back=await deserializeProject(await serializeProject(p,{codec}));
      expect(bits(active(back).well.curves[0]!.data)).toEqual(bits(values));
    }
  });
  it('ids iguales de curva/laboratorio en pozos distintos no mezclan revisiones', async () => {
    const p=await deserializeProject(fixture), w=structuredClone(active(p).well); w.id='other';
    const both=addWell(p,w); const back=await deserializeProject(await serializeProject(both));
    expect(back.wells).toHaveLength(2);
    expect(back.wells[0]!.well.curves[0]!.data).toBe(back.wells[1]!.well.curves[0]!.data);
    expect(back.wells[0]!.inputRevisionId).not.toBe(back.wells[1]!.inputRevisionId);
  });
  it('vacío versionado también se guarda y abre sin inventar un pozo activo', async () => {
    const p=enableProjectInputRevisions(createProject());
    expect(await deserializeProject(await serializeProject(p))).toEqual(p);
  });
  it('forzar v6 con revisiones sigue rechazando la copia incompleta', async () => {
    await expect(serializeProject(await deserializeProject(fixture),{version:6})).rejects.toThrow(/copia incompleta/);
    await expect(serializeProject(createProject(),{version:7})).rejects.toThrow(/habilitar/);
  });
});

describe('integridad antes de publicar', () => {
  it('un bit alterado con dimensiones correctas se rechaza por hash',async()=>{
    const r=parse(),key=Object.keys(r.project.blobs)[0]!,b=r.project.blobs[key];
    const bytes=Uint8Array.from(atob(b.data),c=>c.charCodeAt(0));bytes[0]!^=1;b.data=btoa(String.fromCharCode(...bytes));
    await expect(deserializeProject(json(r))).rejects.toThrow(/hash de integridad/);
  });
  const mutate: Record<string,(r: ReturnType<typeof parse>)=>void> = {
    'hash': r=>{Object.values(r.project.blobs).forEach((b:any)=>b.data='AAAAAAAAAAAAAAAA');},
    'id del blob': r=>{const key=Object.keys(r.project.blobs)[0]!;r.project.blobs[key].sha256='f'.repeat(64);},
    'longitud': r=>{const key=Object.keys(r.project.blobs)[0]!;r.project.blobs[key].byteLength++;},
    'tipo': r=>{const key=Object.keys(r.project.blobs)[0]!;r.project.blobs[key].scalarType='f32';},
    'endian': r=>{const key=Object.keys(r.project.blobs)[0]!;r.project.blobs[key].endian='big';},
    'codec futuro': r=>{const key=Object.keys(r.project.blobs)[0]!;r.project.blobs[key].codec='future';},
    'referencia a blob': r=>{r.project.inputRevisions[rootId].well.curves[0].data={blobId:'missing'};},
    'referencia activa': r=>{r.project.wells[0].inputRevisionId='input-'+ 'f'.repeat(32);},
    'alias duplicado en archivo': r=>{r.project.wells[0].well=r.project.inputRevisions[childId].well;},
    'snapshot': r=>{r.project.snapshots[0].inputRevisionId='missing';},
    'binding': r=>{r.project.snapshots[0].inputBinding='guess';},
    'snapshot duplicado': r=>{r.project.snapshots.push(r.project.snapshots[0]);},
    'pozo duplicado': r=>{r.project.wells.push(r.project.wells[0]);},
    'padre perdido': r=>{r.project.inputRevisions[childId].parentRevisionId='missing';},
    'ciclo': r=>{r.project.inputRevisions[childId].parentRevisionId=childId;},
    'segunda raíz': r=>{delete r.project.inputRevisions[childId].parentRevisionId;r.project.inputRevisions[childId].reason='import';},
    'esquema de revisión': r=>{r.project.inputRevisions[rootId].schemaVersion=2;},
    'esquema de adquisición': r=>{r.project.inputRevisions[rootId].acquisition.schemaVersion=2;},
    'campo futuro de revisión': r=>{r.project.inputRevisions[rootId].future={schemaVersion:2};},
    'array inline inesperado': r=>{r.project.inputRevisions[rootId].well.curves[0].data=[1,2,3];},
    'dimensión de curva': r=>{r.project.inputRevisions[rootId].well.curves[0].data=r.project.inputRevisions[rootId].well.pointSets[0].depth;},
    'fuente futura no disponible': r=>{r.project.wells[0].interpretation.sources.GR={kind:'prepared',curveId:'GR'};},
    'decisión futura': r=>{r.project.snapshots[0].interpretation.pointSets.core.future=1;},
    'motivo desconocido': r=>{r.project.inputRevisions[rootId].reason='guess';},
    'parámetro inválido': r=>{r.project.wells[0].interpretation.params.global.grClean=null;},
  };
  it.each(Object.entries(mutate))('rechaza %s sin reasignar otra revisión', async (_,mutate) => {
    const raw=parse();mutate(raw);await expect(deserializeProject(json(raw))).rejects.toThrow();
  });
  it('un padre de otro pozo no sirve como respaldo de una cadena dañada',async()=>{
    const p=await deserializeProject(fixture),other=structuredClone(active(p).well);other.id='other';
    const raw=JSON.parse(await serializeProject(addWell(p,other)));
    raw.project.inputRevisions[childId].parentRevisionId=raw.project.wells[1].inputRevisionId;
    await expect(deserializeProject(json(raw))).rejects.toThrow();
    const recovered=await recoverProject(json(raw));expect(recovered.project!.wells.map(e=>e.well.id)).toEqual(['other']);
  });
  it('la recuperación explícita conserva el pozo independiente y diagnostica el dañado', async () => {
    let p=await deserializeProject(fixture), other=structuredClone(active(p).well);other.id='other';other.curves[0]!.data[0]=55;
    p=addWell(p,other);
    const raw=JSON.parse(await serializeProject(p,{codec:'f64le-b64'}));
    raw.project.inputRevisions[childId].well.curves[0].data={blobId:'missing'};
    const original=JSON.stringify(raw);
    await expect(deserializeProject(original)).rejects.toThrow(/No se abrió/);
    const recovered=await recoverProject(original);
    expect(recovered.project!.wells.map(e=>e.well.id)).toEqual(['other']);
    expect(recovered.project!.activeWellId).toBeNull();
    expect(recovered.project!.snapshots).toEqual([]);
    expect(recovered.issues.some(x=>x.where.includes(childId))).toBe(true);
    expect(JSON.stringify(raw)).toBe(original);
    expect(await deserializeProject(await serializeProject(recovered.project!))).toEqual(recovered.project);
  });
  it('recuperar un snapshot roto no lo liga a las entradas activas', async () => {
    const raw=parse();raw.project.snapshots[0].inputRevisionId='missing';
    const r=await recoverProject(json(raw));expect(r.project!.snapshots).toEqual([]);expect(r.issues).toHaveLength(1);
    expect(active(r.project!).inputRevisionId).toBe(childId);
  });
  it('si nada es recuperable devuelve null y los diagnósticos, no un proyecto vacío aparente', async () => {
    const raw=parse();raw.project.inputRevisions={};const r=await recoverProject(json(raw));expect(r.project).toBeNull();expect(r.issues.length).toBeGreaterThan(0);
  });
  it('rechaza versiones futuras y versiones inválidas', async () => {
    for (const version of [8,99,0,-1,1.5]) { const r=parse();r.version=version;await expect(deserializeProject(json(r))).rejects.toThrow(); }
  });
});

describe('presupuestos reales', () => {
  it('cuenta UTF-8 antes de parsear, incluyendo pares sustitutos', () => {
    expect(()=>checkFileSize('é😀',6)).not.toThrow();expect(()=>checkFileSize('é😀',5)).toThrow(/UTF-8/);
    expect(()=>checkFileSize('x'.repeat(10),9)).toThrow(/tamaño/);
  });
  it('rechaza longitudes negativas, fraccionarias, inseguras y superiores al presupuesto', async () => {
    for (const length of [-1,0.5,Number.MAX_SAFE_INTEGER,Infinity,NaN]) await expect(decodeArray({codec:'f64le-b64',length,data:''})).rejects.toThrow(/límite|Longitud/);
    expect(()=>archiveLimits({arrayBytes:129*1024**2})).toThrow();expect(()=>archiveLimits({fileBytes:-1})).toThrow();
  });
  it('aplica el límite total a blobs únicos y no a sus referencias repetidas', async () => {
    const r=parse(),total=Object.values(r.project.blobs).reduce((n:number,b:any)=>n+b.byteLength,0) as number;
    await expect(deserializeProject(fixture,{limits:{totalBytes:total}})).resolves.toBeDefined();
    await expect(deserializeProject(fixture,{limits:{totalBytes:total-1}})).rejects.toThrow(/límite/);
    await expect(recoverProject(fixture,{limits:{totalBytes:total-1}})).rejects.toThrow(/límite/);
  });
  it('corta un stream que expande más que lo declarado, antes de entregar el array', async () => {
    const enc=await encodeArray(new Float64Array(10000),'f64le-deflate-b64');
    enc.length=1;
    await expect(decodeArray(enc)).rejects.toThrow(/descompresión.*límite/);
  });
  it('un stream truncado o con menos datos no produce un array parcial', async () => {
    const enc=await encodeArray(Float64Array.of(1,2,3),'f64le-deflate-b64');
    await expect(decodeArray({...enc,length:4})).rejects.toThrow();
    await expect(decodeArray({...enc,data:enc.data.slice(0,8)})).rejects.toThrow();
  });
  it('un límite alcanzado en laboratorio legado no se trata como columna descartable', async () => {
    const p=addWell(createProject(),createWell({id:'w',name:'w',depth:Float64Array.of(1),curves:[],pointSets:[createPointSet({id:'c',kind:'core',name:'c',depth:Float64Array.of(1),pointIds:['p'],columns:{x:{label:'x',unit:'m',values:Float64Array.of(2)}}})]}));
    const text=await serializeProject(p,{codec:'f64le-b64'});
    await expect(deserializeProject(text,{limits:{totalBytes:16}})).rejects.toThrow(/límite/);
  });
  it('el presupuesto valida antes de reservar sin asignar arrays gigantes',()=>{expect(()=>new DecodeBudget().reserve(2**40)).toThrow(/límite/);});
});

describe('hash offline', () => {
  it.each(['','abc','a'.repeat(55),'a'.repeat(56),'a'.repeat(64),'a'.repeat(1000)])('fallback coincide con SHA-256 independiente para %j', async text=>{
    const data=new TextEncoder().encode(text);expect(await sha256Fallback(data)).toBe(await nativeHash(data));
  });
  it('coincide sin crypto y si SubtleCrypto falla, también con subarrays',async()=>{
    const data=Uint8Array.from({length:1000},(_,i)=>i%256).subarray(7,999), hash=await nativeHash(data);
    vi.stubGlobal('crypto',undefined);expect(await sha256(data)).toBe(hash);
    vi.stubGlobal('crypto',{subtle:{digest:async()=>{throw new Error('offline');}}});expect(await sha256(data)).toBe(hash);
  });
  it('un megabyte de datos se procesa exactamente con el fallback por bloques',async()=>{const data=new Uint8Array(1024*1024+17).fill(97);expect(await sha256Fallback(data)).toBe(await nativeHash(data));});
});

const corpus=import.meta.glob<string>('../fixtures/projects/v*.pozo.json',{query:'?raw',import:'default',eager:true});
describe.each(Object.entries(corpus))('migración explícita %s',(_,text)=>{
  it('guarda v7, reabre y conserva fuentes/decisiones/datos y el límite histórico de los snapshots',async()=>{
    const old=await deserializeProject(text), warnings:string[]=[];
    const p=await deserializeProject(text,{upgradeInputs:true,onWarning:m=>warnings.push(m)});
    expect(p.wells.map(e=>e.well)).toEqual(old.wells.map(e=>e.well));
    expect(p.wells.map(e=>e.interpretation)).toEqual(old.wells.map(e=>e.interpretation));
    expect(p.snapshots.every(s=>s.inputBinding==='legacy-current-inputs')).toBe(true);
    const back=await deserializeProject(await serializeProject(p,{codec:'f64le-b64'}),{onWarning:m=>warnings.push(m)});
    expect(back).toEqual(p);expect(projectInputState(back)).not.toBeNull();
    if (p.snapshots.length) expect(warnings.some(m=>m.includes('históric'))).toBe(true);
    for (const s of back.snapshots) expect(resolveSnapshotInputs(back,s).inputRevisionId).toBe(s.inputRevisionId);
    expect(JSON.parse(await serializeProject(old)).version).toBe(6);
  });
});
