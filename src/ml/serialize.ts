/**
 * Serialización binaria del random forest (`ForestModel`) y codificación de texto para incrustarlo en el build.
 *
 * Formato (little-endian, secciones alineadas a 4 bytes):
 *   bytes 0–3   magia «PRF1»
 *   bytes 4–7   u32 = longitud L del JSON de cabecera
 *   L bytes     JSON UTF-8 {formatVersion, featureNames, meta, K, d, T, nTrees, nNodes, nLeaves, edgeCounts}
 *   luego, cada una alineada a 4: classCodes (i32 K) · classPriors (f32 K) · edges (f32 Σ edgeCounts) ·
 *   importance (f32 d) · treeStart (u32 nTrees+1) · nodeFeature (u8) · nodeThreshold (u8) · nodeRight (u16) ·
 *   leafClass (u8 nLeaves·T) · leafProb (u8 nLeaves·T)
 *
 * Ida y vuelta exacta: `serializeModel(deserializeModel(b))` reproduce los mismos bytes (todos los arrays se guardan
 * con su tipo nativo; el JSON se escribe en orden fijo de claves).
 *
 * Para el HTML único, `encodeModelText` comprime con zlib (fflate, ya dependencia del proyecto) y pasa a base64.
 */

import { unzlibSync, zlibSync } from 'fflate';
import { type ForestModel } from './forest.ts';

const MAGIC = [0x50, 0x52, 0x46, 0x31]; // "PRF1"

function align4(n: number): number {
  return (n + 3) & ~3;
}

function assertLittleEndian(): void {
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error('Plataforma big-endian no soportada.');
}

/** Serializa el modelo a bytes. */
export function serializeModel(model: ForestModel): Uint8Array {
  assertLittleEndian();
  const K = model.classCodes.length;
  const d = model.featureNames.length;
  const header = {
    formatVersion: model.formatVersion,
    featureNames: model.featureNames,
    meta: model.meta,
    K,
    d,
    T: model.leafTop,
    nTrees: model.treeStart.length - 1,
    nNodes: model.nodeFeature.length,
    nLeaves: model.leafProb.length / model.leafTop,
    edgeCounts: model.edges.map(e => e.length),
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const parts: Uint8Array[] = [
    new Uint8Array(model.classCodes.buffer, model.classCodes.byteOffset, model.classCodes.byteLength),
    new Uint8Array(model.classPriors.buffer, model.classPriors.byteOffset, model.classPriors.byteLength),
  ];
  const edgesFlat = new Float32Array(model.edges.reduce((s, e) => s + e.length, 0));
  let at = 0;
  for (const e of model.edges) {
    edgesFlat.set(e, at);
    at += e.length;
  }
  for (const arr of [edgesFlat, model.importance, model.treeStart, model.nodeFeature, model.nodeThreshold, model.nodeRight, model.leafClass, model.leafProb]) {
    parts.push(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
  }
  let size = align4(8 + json.length);
  for (const p of parts) size += align4(p.length);
  const out = new Uint8Array(size);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  let pos = align4(8 + json.length);
  for (const p of parts) {
    out.set(p, pos);
    pos += align4(p.length);
  }
  return out;
}

/** Reconstruye el modelo desde bytes. Lanza error si el formato no es reconocido o está truncado. */
export function deserializeModel(bytes: Uint8Array): ForestModel {
  assertLittleEndian();
  if (bytes.length < 8 || MAGIC.some((b, i) => bytes[i] !== b)) throw new Error('Modelo inválido: magia incorrecta.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLen = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + jsonLen))) as {
    formatVersion: number;
    featureNames: string[];
    meta: ForestModel['meta'];
    K: number;
    d: number;
    T: number;
    nTrees: number;
    nNodes: number;
    nLeaves: number;
    edgeCounts: number[];
  };
  if (header.formatVersion !== 1) throw new Error(`Versión de formato no soportada: ${header.formatVersion}.`);
  let pos = align4(8 + jsonLen);
  const take = <T extends Float32Array | Int32Array | Uint32Array | Uint16Array | Uint8Array>(
    ctor: { new (buffer: ArrayBuffer): T; BYTES_PER_ELEMENT: number },
    count: number,
  ): T => {
    const byteLen = count * ctor.BYTES_PER_ELEMENT;
    if (pos + byteLen > bytes.length) throw new Error('Modelo truncado.');
    // Copia a un buffer propio y alineado (el origen puede no estar alineado).
    const copy = bytes.slice(pos, pos + byteLen).buffer as ArrayBuffer;
    pos += align4(byteLen);
    return new ctor(copy);
  };
  const { K, d, T, nTrees, nNodes, nLeaves } = header;
  const classCodes = take(Int32Array, K);
  const classPriors = take(Float32Array, K);
  const edgesFlat = take(Float32Array, header.edgeCounts.reduce((s, c) => s + c, 0));
  const importance = take(Float32Array, d);
  const treeStart = take(Uint32Array, nTrees + 1);
  const nodeFeature = take(Uint8Array, nNodes);
  const nodeThreshold = take(Uint8Array, nNodes);
  const nodeRight = take(Uint16Array, nNodes);
  const leafClass = take(Uint8Array, nLeaves * T);
  const leafProb = take(Uint8Array, nLeaves * T);
  const edges: Float32Array[] = [];
  let at = 0;
  for (const c of header.edgeCounts) {
    edges.push(edgesFlat.slice(at, at + c));
    at += c;
  }
  return {
    formatVersion: 1,
    featureNames: header.featureNames,
    classCodes,
    classPriors,
    edges,
    nodeFeature,
    nodeThreshold,
    nodeRight,
    leafTop: T,
    treeStart,
    leafClass,
    leafProb,
    importance,
    meta: header.meta,
  };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 estándar (con relleno «=») sin depender de `btoa`/`Buffer`. */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const CHUNK = 3 * 8192;
  for (let s = 0; s < bytes.length; s += CHUNK) {
    let out = '';
    const end = Math.min(bytes.length, s + CHUNK);
    for (let i = s; i < end; i += 3) {
      const b0 = bytes[i]!;
      const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
      const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
      out += B64[b0 >> 2]! + B64[((b0 & 3) << 4) | (b1 >> 4)]!;
      out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)]! : '=';
      out += i + 2 < bytes.length ? B64[b2 & 63]! : '=';
    }
    parts.push(out);
  }
  return parts.join('');
}

export function base64ToBytes(text: string): Uint8Array {
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) lookup[B64.charCodeAt(i)] = i;
  const clean = text.replace(/[\s=]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = lookup[clean.charCodeAt(i)] ?? -1;
    if (v < 0) throw new Error('Base64 inválido.');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** Modelo → texto (zlib nivel 9 + base64) apto para incrustar en un módulo TypeScript. */
export function encodeModelText(model: ForestModel): string {
  return bytesToBase64(zlibSync(serializeModel(model), { level: 9 }));
}

/** Texto producido por `encodeModelText` → modelo. */
export function decodeModelText(text: string): ForestModel {
  return deserializeModel(unzlibSync(base64ToBytes(text)));
}
