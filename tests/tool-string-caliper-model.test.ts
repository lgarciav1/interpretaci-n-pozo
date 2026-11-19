import { expect, it } from 'vitest';
import { Color, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { caliperModel } from '../src/app/toolString/caliperModel';
import { AXIAL_COMPRESSION, CALIPER_LINK_CM, CALIPER_SHOE_PIN_CM, dir, LEAN_AZIMUTH } from '../src/app/toolString/scene';

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
    shoeRadius, shoeY: 2, style: { color: '#aaa', look: 'off', emphasis: 'selected', edge: '#00ffff', opacity: 1 } }, loaded);
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
