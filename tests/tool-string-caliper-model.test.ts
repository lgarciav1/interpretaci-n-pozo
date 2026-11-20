import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Color, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { caliperModel, CaliperTextures } from '../src/app/toolString/caliperModel';
import { AXIAL_COMPRESSION, type Emphasis, CALIPER_LINK_CM, CALIPER_SHOE_PIN_CM, dir, LEAN_AZIMUTH } from '../src/app/toolString/scene';

// Node puede leer la URL blob del GLB, pero no incluye el decodificador de imágenes del
// navegador. La decodificación de píxeles y su subida a la GPU se comprueban en Chromium.
beforeAll(() => {
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
    if (!blob.type.startsWith('image/') || !blob.size) throw new Error('Imagen embebida vacía');
    return { width: 1, height: 1 };
  });
});
afterAll(() => vi.unstubAllGlobals());

it('coloca la cara de contacto del GLB en el azimut opuesto al patín y el pasador proximal sobre el cuerpo', async () => {
  const azimuth = LEAN_AZIMUTH + Math.PI;
  const [dx, dz] = dir(azimuth);
  const rootRadius = 2.03;
  const shoeRadius = 16.4592;
  const extension = shoeRadius - CALIPER_SHOE_PIN_CM - rootRadius;
  const rootY = 2 + Math.sqrt(CALIPER_LINK_CM ** 2 - extension ** 2) / AXIAL_COMPRESSION;
  let loaded!: () => void;
  const ready = new Promise<void>(resolve => { loaded = resolve; });
  const model = caliperModel({ key: 'arm:caliper', kind: 'caliper', azimuth, rootRadius, rootY,
    shoeRadius, shoeY: 2, style: { color: '#aaa', look: 'off', emphasis: 'selected', edge: '#00ffff', opacity: 1 } }, new CaliperTextures(), loaded);
  new Group().add(model);
  await ready;
  const expected = (r: number, y: number) => new Vector3(dx * r, y, dz * r);
  const origin = (part: string) => model.getObjectByName(part)!.localToWorld(new Vector3());
  expect(origin('CaliperPivot').distanceTo(expected(rootRadius, rootY))).toBeLessThan(1e-8);
  expect(origin('CaliperShoe').distanceTo(expected(shoeRadius, 2))).toBeLessThan(1e-8);
  const distal = model.getObjectByName('CaliperLink')!.localToWorld(new Vector3(0, 1, 0));
  expect(distal.distanceTo(expected(shoeRadius - CALIPER_SHOE_PIN_CM, 2))).toBeLessThan(1e-8);
  const shoe = model.getObjectByName('CaliperShoe')!;
  const up = shoe.localToWorld(new Vector3(0, 1, 0)).sub(origin('CaliperShoe'));
  expect(up.y).toBeCloseTo(1 / AXIAL_COMPRESSION, 9);
  shoe.traverse(part => {
    if (part instanceof Mesh && part.material instanceof MeshStandardMaterial) {
      expect(part.material.metalness).toBe(0);
      expect(part.material.emissive).toEqual(new Color('#00ffff').multiplyScalar(0.32));
    }
  });
});

it('conserva los mapas PBR durante hover y libera solo las copias del renderizador que se cierra', async () => {
  const active = new CaliperTextures();
  const second = new CaliperTextures();
  async function load(textures: CaliperTextures, emphasis: Emphasis) {
    let ready!: () => void;
    const done = new Promise<void>(resolve => { ready = resolve; });
    const group = caliperModel({ kind: 'caliper', key: 'arm:caliper', azimuth: 0,
      rootRadius: 2, rootY: 5, shoeRadius: 11, shoeY: 2,
      style: { color: '#aaa', look: 'on', emphasis, opacity: 1 } }, textures, ready);
    new Group().add(group);
    await done;
    const link = group.getObjectByName('CaliperLink')!;
    const materials: MeshStandardMaterial[] = [];
    link.traverse(part => {
      if (part instanceof Mesh && part.material instanceof MeshStandardMaterial && part.material.map) {
        expect(part.geometry.hasAttribute('uv')).toBe(true);
        materials.push(part.material);
      }
    });
    expect(materials.length).toBeGreaterThan(0);
    return materials[0]!;
  }
  const normal = await load(active, 'none');
  const hovered = await load(active, 'hover');
  const other = await load(second, 'none');
  expect(hovered.emissive.r).toBeGreaterThan(normal.emissive.r);
  const disposeActive = vi.fn();
  const disposeSecond = vi.fn();
  for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap'] as const) {
    const texture = normal[slot]!;
    expect(texture).toBeTruthy();
    expect(hovered[slot]).toBe(texture);
    expect(other[slot]).not.toBe(texture);
    expect(other[slot]!.source).toBe(texture.source);
    texture.addEventListener('dispose', disposeActive);
    other[slot]!.addEventListener('dispose', disposeSecond);
  }
  const maps = new Set([normal.map, normal.normalMap, normal.roughnessMap, normal.metalnessMap]);
  active.dispose();
  expect(disposeActive).toHaveBeenCalledTimes(maps.size);
  expect(disposeSecond).not.toHaveBeenCalled();
  second.dispose();
  expect(disposeSecond).toHaveBeenCalledTimes(maps.size);
});
