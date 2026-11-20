import { Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, type Texture, type Material, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import modelUrl from './assets/caliper.glb?url&inline';
import { AXIAL_COMPRESSION, CALIPER_SHOE_PIN_CM, type ScenePrimitive, type Style } from './scene';

type Caliper = Extract<ScenePrimitive, { kind: 'caliper' }>;

let template: Promise<Group> | undefined;

/** El GLB es parte del HTML. Se decodifica una vez, y Three lee las imágenes desde sus buffers mediante URL blob locales. */
function loadTemplate(): Promise<Group> {
  if (!template) {
    const bytes = Uint8Array.from(atob(modelUrl.slice(modelUrl.indexOf(',') + 1)), c => c.charCodeAt(0));
    template = new GLTFLoader().parseAsync(bytes.buffer, '').then(model => model.scene);
  }
  return template;
}

/** Una copia GPU por textura y contexto WebGL. Las copias comparten los píxeles decodificados
 * de la plantilla, y conservan su identidad al pasar el puntero o cambiar la apertura. */
export class CaliperTextures {
  private readonly copies = new Map<Texture, Texture>();

  get(texture: Texture): Texture {
    let copy = this.copies.get(texture);
    if (!copy) {
      copy = texture.clone();
      this.copies.set(texture, copy);
    }
    return copy;
  }

  dispose(): void {
    for (const texture of this.copies.values()) texture.dispose();
    this.copies.clear();
  }
}

function styledMaterial(material: Material, style: Style, textures: CaliperTextures): Material {
  if (style.look === 'ghost') {
    return new MeshBasicMaterial({ color: style.edge ?? style.color, transparent: true, opacity: 0.32, depthWrite: false });
  }
  const out = style.look === 'off'
    ? new MeshStandardMaterial({ color: style.color, metalness: 0, roughness: 0.92 })
    : material.clone();
  if (out instanceof MeshStandardMaterial) {
    for (const slot of ['map', 'normalMap', 'metalnessMap', 'roughnessMap'] as const) {
      if (out[slot]) out[slot] = textures.get(out[slot]);
    }
    if (style.emphasis !== 'none') {
      out.emissive = new Color(style.edge ?? 0xffffff).multiplyScalar(style.emphasis === 'selected' ? 0.32 : 0.1);
    }
  }
  return out;
}

function instance(part: Object3D, style: Style, textures: CaliperTextures): Object3D {
  const copy = part.clone(true);
  copy.traverse(child => {
    if (!(child instanceof Mesh)) return;
    // Cada vista libera sus instancias al cambiar de pozo, selección o tema.
    child.geometry = child.geometry.clone();
    const materials = child.material;
    child.material = Array.isArray(materials) ? materials.map(m => styledMaterial(m, style, textures)) : styledMaterial(materials, style, textures);
    child.castShadow = child.receiveShadow = style.look !== 'ghost';
    if (style.look === 'ghost') child.renderOrder = 2;
  });
  return copy;
}

/** Coloca piezas modeladas en su plano de apertura. El origen de la zapata es su cara exterior. */
export function caliperModel(p: Caliper, textures: CaliperTextures, onReady: () => void): Group {
  const group = new Group();
  group.rotation.y = p.azimuth - Math.PI / 2;
  group.position.y = p.shoeY;
  // La pose local usa centímetros físicos. El grupo comprime luego toda la mecánica,
  // incluidos los ojos de la biela y los pasadores que deben quedar concéntricos.
  group.scale.y = 1 / AXIAL_COMPRESSION;
  void loadTemplate().then(scene => {
    if (!group.parent) return; // La escena cambió mientras se decodificaba el GLB.
    const linkNode = scene.getObjectByName('CaliperLink');
    const pivotNode = scene.getObjectByName('CaliperPivot');
    const shoeNode = scene.getObjectByName('CaliperShoe');
    if (!linkNode || !pivotNode || !shoeNode) throw new Error('Piezas del calibre incompletas');
    const tip = p.shoeRadius - CALIPER_SHOE_PIN_CM;
    const dx = tip - p.rootRadius;
    const dy = (p.shoeY - p.rootY) * AXIAL_COMPRESSION;
    const link = instance(linkNode, p.style, textures);
    link.position.set(p.rootRadius, -dy, 0);
    link.rotation.z = Math.atan2(-dx, dy);
    link.scale.y = Math.hypot(dx, dy);
    const root = instance(pivotNode, p.style, textures);
    root.position.copy(link.position);
    const shoe = instance(shoeNode, p.style, textures);
    shoe.position.set(p.shoeRadius, 0, 0);
    group.add(link, root, shoe);
    onReady();
  });
  return group;
}
