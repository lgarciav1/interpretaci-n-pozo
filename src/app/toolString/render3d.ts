/**
 * Dibujo WebGL de la escena de la sarta (docs/decisiones/0033, D3–D4): traduce la descripción pura de `scene.ts` a
 * mallas de three.js. No decide nada de geometría ni de estados: solo materiales, luces, cámara e interacción.
 *
 * - Render a demanda: se dibuja cuando cambian la cámara (evento `change` de los controles), la escena o el tamaño
 *   (`ResizeObserver`). El único bucle es el de la animación de «Vista inicial» (sin animación con movimiento reducido).
 * - Reutiliza por clave: un objeto se reconstruye solo si su primitiva cambió (al pasar el puntero cambian 2–5 piezas).
 * - Rótulos en HTML (nítidos, con los tokens del CSS) sobre el lienzo, reposicionados en cada cuadro.
 * - `dispose()` libera geometrías, materiales, texturas, controles y el contexto.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  BackSide,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  type Material,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  Scene,
  Shape,
  Spherical,
  SRGBColorSpace,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { bandAlpha, dir, initialCamera, type BandPrimitive, type EnvironmentDesc, type Pick, type RulerDesc, type ScenePrimitive, type ShellPrimitive, type Style, type ToolStringScene, type Vec3 } from './scene';

export interface RendererCallbacks {
  /** Pieza bajo el puntero (null = ninguna), con la posición del puntero relativa al contenedor. */
  onHover(pick: Pick | null, at: { x: number; y: number } | null): void;
  /** Clic sin arrastre: pieza tocada o null (vacío). */
  onPick(pick: Pick | null): void;
}

/** true si el navegador puede crear un contexto WebGL 2 (three.js lo exige desde r163). */
export function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

const FOV = 32;
const UP = new Vector3(0, 1, 0);

/** Clave de reutilización: la primitiva entera (si cambia algo, se reconstruye ese objeto). */
const sig = (x: unknown) => JSON.stringify(x);

export class ToolStringRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 1, 30000);
  private readonly controls: OrbitControls;
  private readonly objects = new Map<string, { object: Object3D; sig: string }>();
  private readonly pickables: Object3D[] = [];
  private readonly blockers: Object3D[] = [];
  private readonly labelsLayer: HTMLDivElement;
  private labels: { el: HTMLSpanElement; pos: Vector3; kind: string; w: number; h: number }[] = [];
  private readonly ro: ResizeObserver;
  private readonly raycaster = new Raycaster();
  private desc: ToolStringScene | null = null;
  private frame = 0;
  private tween = 0;
  private hoverFrame = 0;
  private size = { w: 1, h: 1 };
  private down: { x: number; y: number } | null = null;
  private lastHover: string | null = null;
  private disposed = false;
  /** La usuaria movió la cámara desde la última vista inicial (entonces no se reencuadra sola). */
  private userMoved = false;
  private boundsSig = '';

  constructor(
    private readonly container: HTMLElement,
    private readonly cb: RendererCallbacks,
    private readonly reducedMotion: () => boolean,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'default' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    const canvas = this.renderer.domElement;
    canvas.className = 'ts3d__canvas';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);
    this.labelsLayer = document.createElement('div');
    this.labelsLayer.className = 'ts3d__labels';
    this.labelsLayer.setAttribute('aria-hidden', 'true');
    container.appendChild(this.labelsLayer);

    this.scene.add(new HemisphereLight(0xffffff, 0x6b5a45, 1.9));
    const key = new DirectionalLight(0xffffff, 2.1);
    key.position.set(260, 520, 420);
    this.scene.add(key);
    const rim = new DirectionalLight(0xffffff, 0.7);
    rim.position.set(-300, 120, -200);
    this.scene.add(rim);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.minDistance = 8;
    this.controls.addEventListener('change', this.requestRender);
    this.controls.addEventListener('start', this.onControlStart);

    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
  }

  // ------------------------------------------------------------------------------------------------------------
  // API

  /** Aplica una descripción nueva. Con `fit` (primera vez o cambio grande) pone la vista inicial. */
  setScene(desc: ToolStringScene, background: string, fit = false): void {
    const first = !this.desc;
    // Si la sarta cambió de tamaño (agregar o quitar herramientas) y la cámara no se tocó, se reencuadra.
    const bs = sig(desc.bounds);
    const grew = bs !== this.boundsSig;
    this.boundsSig = bs;
    this.desc = desc;
    this.scene.background = new Color(background);
    const seen = new Set<string>();
    const put = (key: string, value: unknown, make: () => Object3D, pickable = false, blocker = false) => {
      seen.add(key);
      const s = sig(value);
      const prev = this.objects.get(key);
      if (prev && prev.sig === s) return;
      if (prev) this.remove(key, prev.object);
      const object = make();
      object.userData.key = key;
      this.scene.add(object);
      this.objects.set(key, { object, sig: s });
      if (pickable) this.pickables.push(object);
      if (blocker) this.blockers.push(object);
    };
    put('env', desc.environment, () => this.environment(desc.environment), false, true);
    put('ruler', desc.ruler, () => ruler(desc.ruler));
    for (const p of desc.primitives) put(p.key, p, () => primitive(p), !!p.pick);
    // Cáscaras: de afuera hacia adentro (las de adentro se ven a través de las de afuera).
    const shells = [...desc.shells].sort((a, b) => b.radius - a.radius);
    shells.forEach((s, i) => put(s.key, { s, i }, () => shell(s, i)));
    for (const b of desc.bands) put(b.key, b, () => band(b));
    for (const [key, { object }] of [...this.objects]) if (!seen.has(key)) this.remove(key, object);
    this.buildLabels(desc);
    if (first || fit || (grew && !this.userMoved)) this.resetView(false);
    else this.requestRender();
  }

  /** Vuelve a la vista inicial (animada salvo movimiento reducido). */
  resetView(animate = true): void {
    if (!this.desc) return;
    const { position, target } = initialCamera(this.desc, this.size.w / this.size.h, FOV);
    const d = Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]);
    this.controls.maxDistance = d * 5;
    this.flyTo(new Vector3(...position), new Vector3(...target), animate);
    this.userMoved = false;
  }

  /** Lleva la cámara a una posición y un objetivo, animada salvo movimiento reducido. */
  private flyTo(p1: Vector3, t1: Vector3, animate: boolean): void {
    cancelAnimationFrame(this.tween);
    if (!animate || this.reducedMotion()) {
      this.camera.position.copy(p1);
      this.controls.target.copy(t1);
      this.controls.update();
      this.requestRender();
      return;
    }
    const p0 = this.camera.position.clone();
    const t0 = this.controls.target.clone();
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 420);
      const e = 1 - Math.pow(1 - k, 3);
      this.camera.position.lerpVectors(p0, p1, e);
      this.controls.target.lerpVectors(t0, t1, e);
      this.controls.update();
      if (k < 1) this.tween = requestAnimationFrame(step);
    };
    this.tween = requestAnimationFrame(step);
  }

  /** Gira la cámara alrededor del objetivo (teclado): `dTheta` en azimut, `dPhi` en elevación, en radianes. */
  orbit(dTheta: number, dPhi: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const s = new Spherical().setFromVector3(offset);
    s.theta += dTheta;
    s.phi = Math.min(Math.PI - 0.05, Math.max(0.05, s.phi + dPhi));
    offset.setFromSpherical(s);
    this.camera.position.copy(this.controls.target).add(offset);
    this.userMoved = true;
    this.controls.update();
  }

  /** Acerca (k < 1) o aleja (k > 1) la cámara del objetivo (teclado). */
  zoom(k: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const len = Math.min(this.controls.maxDistance, Math.max(this.controls.minDistance, offset.length() * k));
    this.camera.position.copy(this.controls.target).add(offset.setLength(len));
    this.userMoved = true;
    this.controls.update();
  }

  /**
   * Encuadra una herramienta con sus cáscaras, mirando desde la dirección actual (desde el lado del corte si la cámara
   * está del otro lado).
   */
  focusTool(toolId: string): void {
    const d = this.desc;
    const t = d?.tools.find((x) => x.toolId === toolId);
    if (!d || !t) return;
    const reach = Math.max(d.environment.rWall * 7, ...d.shells.filter((s) => s.toolId === toolId).map((s) => s.radius), ...d.bands.filter((b) => b.toolId === toolId).map((b) => b.rMax));
    const target = new Vector3(reach * 0.2 * Math.SQRT1_2, (t.y0 + t.y1) / 2, reach * 0.2 * Math.SQRT1_2);
    const dirv = this.camera.position.clone().sub(this.controls.target).normalize();
    // Del lado del corte (θ entre 0 y π/2 mira a +x, +z): si no, la vista inicial.
    if (dirv.x < 0.15 || dirv.z < 0.15) dirv.set(Math.SQRT1_2, 0.55, Math.SQRT1_2).normalize();
    const size = Math.max(reach * 2.2, (t.y1 - t.y0) * 1.5);
    const dist = size / 2 / Math.tan(((FOV * Math.PI) / 180) / 2) / Math.min(1, this.size.w / this.size.h);
    this.flyTo(target.clone().add(dirv.multiplyScalar(dist)), target, true);
    this.userMoved = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.tween);
    cancelAnimationFrame(this.hoverFrame);
    this.ro.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    this.controls.removeEventListener('change', this.requestRender);
    this.controls.removeEventListener('start', this.onControlStart);
    this.controls.dispose();
    for (const [key, { object }] of [...this.objects]) this.remove(key, object);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    canvas.remove();
    this.labelsLayer.remove();
  }

  // ------------------------------------------------------------------------------------------------------------
  // Dibujo

  private readonly requestRender = () => {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderer.render(this.scene, this.camera);
      this.placeLabels();
    });
  };

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    if (w === this.size.w && h === this.size.h) return;
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Mientras la usuaria no mueva la cámara, la vista inicial se reencuadra con el tamaño (abrir la ficha, la ventana).
    if (this.desc && !this.userMoved) this.resetView(false);
    else this.requestRender();
  }

  private remove(key: string, object: Object3D): void {
    this.scene.remove(object);
    disposeObject(object);
    this.objects.delete(key);
    const i = this.pickables.indexOf(object);
    if (i >= 0) this.pickables.splice(i, 1);
    const j = this.blockers.indexOf(object);
    if (j >= 0) this.blockers.splice(j, 1);
  }

  private buildLabels(desc: ToolStringScene): void {
    this.labelsLayer.replaceChildren();
    this.labels = desc.labels.map((l) => {
      const el = document.createElement('span');
      el.className = `ts3d__label ts3d__label--${l.kind}`;
      el.textContent = l.text;
      if (l.color) el.style.setProperty('--ts3d-label-color', l.color);
      this.labelsLayer.appendChild(el);
      return { el, pos: new Vector3(...l.position), kind: l.kind, w: 0, h: 0 };
    });
  }

  /**
   * Ubica los rótulos sobre el lienzo. Sin superposiciones: los de la regla que chocan con uno anterior se ocultan
   * (quedan las marcas) y los de las cáscaras se corren hacia abajo hasta tener lugar.
   */
  private placeLabels(): void {
    const v = new Vector3();
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const hit = (r: { x0: number; x1: number; y0: number; y1: number }) => placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0);
    for (const l of this.labels) {
      v.copy(l.pos).project(this.camera);
      if (v.z > 1 || v.z < -1) {
        l.el.style.visibility = 'hidden';
        continue;
      }
      if (!l.w) {
        l.w = l.el.offsetWidth;
        l.h = l.el.offsetHeight;
      }
      const x = ((v.x + 1) / 2) * this.size.w;
      let y = ((1 - v.y) / 2) * this.size.h;
      // Caja aproximada según cómo la corre el CSS de cada clase.
      const box = (yy: number) =>
        l.kind === 'tick' ? { x0: x - l.w / 2, x1: x + l.w / 2, y0: yy - 22, y1: yy - 22 + l.h } : l.kind === 'tool' ? { x0: x - l.w - 22, x1: x - 22, y0: yy - l.h / 2, y1: yy + l.h / 2 } : { x0: x + 4, x1: x + 4 + l.w, y0: yy - 10, y1: yy - 10 + l.h };
      let r = box(y);
      if (l.kind === 'shell') {
        for (let k = 0; k < 8 && hit(r); k++) r = box((y += l.h + 2));
      } else if (l.kind === 'tick' && hit(r)) {
        l.el.style.visibility = 'hidden';
        continue;
      }
      placed.push(r);
      l.el.style.visibility = 'visible';
      l.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }

  /** Formación en corte, pared, lodo y cable. */
  private environment(env: EnvironmentDesc): Object3D {
    const g = new Group();
    const H = env.y1 - env.y0;
    const ym = (env.y0 + env.y1) / 2;
    const [w0, wl] = env.wedge;
    const restStart = w0 + wl;
    const restLen = Math.PI * 2 - wl;
    const repeat = Math.max(1, H / 110);
    const outerTex = this.strata(env.colors.formation, env.colors.formationAlt, repeat);
    const cutTex = this.strata(env.colors.formationCut, env.colors.formation, repeat);
    const wallTex = this.strata(env.colors.wall, mixHex(env.colors.wall, '#000000', 0.18), repeat);

    const outer = new Mesh(new CylinderGeometry(env.rOuter, env.rOuter, H, 120, 1, true, restStart, restLen), new MeshStandardMaterial({ map: outerTex, roughness: 0.95, metalness: 0 }));
    outer.position.y = ym;
    const wall = new Mesh(new CylinderGeometry(env.rWall, env.rWall, H, 48, 1, true, restStart, restLen), new MeshStandardMaterial({ map: wallTex, roughness: 1, metalness: 0, side: BackSide }));
    wall.position.y = ym;
    const capMat = new MeshStandardMaterial({ color: new Color(env.colors.formationCut), roughness: 0.95, metalness: 0, side: DoubleSide });
    const top = new Mesh(annularSector(env.rWall, env.rOuter, restStart, restStart + restLen, env.y1, 96), capMat);
    const bottom = new Mesh(annularSector(env.rWall, env.rOuter, restStart, restStart + restLen, env.y0, 96), capMat);
    const cutMat = new MeshStandardMaterial({ map: cutTex, roughness: 0.9, metalness: 0, side: DoubleSide });
    const cutA = new Mesh(radialQuad(w0, env.rWall, env.rOuter, env.y0, env.y1), cutMat);
    const cutB = new Mesh(radialQuad(w0 + wl, env.rWall, env.rOuter, env.y0, env.y1), cutMat);
    // Lodo: caras del corte y superficie, translúcidas (sin escribir profundidad: no tapan la sarta).
    const mudMat = new MeshBasicMaterial({ color: new Color(env.colors.mud), transparent: true, opacity: 0.16, depthWrite: false, side: DoubleSide });
    const mudA = new Mesh(radialQuad(w0, 0, env.rWall, env.y0, env.y1), mudMat);
    const mudB = new Mesh(radialQuad(w0 + wl, 0, env.rWall, env.y0, env.y1), mudMat);
    const mudTop = new Mesh(annularSector(0.01, env.rWall, restStart, restStart + restLen, env.y1 - 0.4, 48), mudMat);
    mudA.renderOrder = mudB.renderOrder = mudTop.renderOrder = 1;
    // Cable.
    const c = env.cable;
    const cable = rodMesh(c.from, c.to, c.radius, new MeshStandardMaterial({ color: new Color(c.color), roughness: 0.6, metalness: 0.2 }));
    // Borde del corte: líneas finas para que el recorte se lea como un corte.
    const edgeMat = new LineBasicMaterial({ color: new Color(mixHex(env.colors.formationCut, '#000000', 0.35)), transparent: true, opacity: 0.6 });
    const edges = new LineSegments(new BufferGeometry().setFromPoints([...edgeOf(w0, env), ...edgeOf(w0 + wl, env)]), edgeMat);
    g.add(outer, wall, top, bottom, cutA, cutB, mudA, mudB, mudTop, cable, edges);
    // Lo transparente no bloquea la selección.
    for (const m of [mudA, mudB, mudTop, edges, cable]) m.raycast = () => {};
    return g;
  }

  /** Textura de estratos: bandas horizontales de espesor irregular (semilla fija: siempre la misma). */
  private strata(a: string, b: string, repeat: number): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    let y = 0;
    let i = 0;
    while (y < 256) {
      const h = 10 + Math.floor(rnd() * 34);
      ctx.fillStyle = i % 2 ? b : mixHex(a, b, rnd() * 0.35);
      ctx.fillRect(0, y, 4, h);
      y += h;
      i++;
    }
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.repeat.set(1, repeat);
    return tex;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Puntero

  private readonly onControlStart = () => {
    this.userMoved = true;
    cancelAnimationFrame(this.tween);
  };

  private readonly onPointerDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
  };

  private readonly onPointerUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || e.button !== 0) return;
    this.cb.onPick(this.hit(e));
  };

  private readonly onPointerMove = (e: PointerEvent) => {
    if (e.buttons) return; // arrastrando la cámara
    const { clientX, clientY } = e;
    cancelAnimationFrame(this.hoverFrame);
    this.hoverFrame = requestAnimationFrame(() => {
      const pick = this.hit({ clientX, clientY });
      const rect = this.container.getBoundingClientRect();
      const k = pick ? sig(pick) : null;
      if (k === this.lastHover && !pick) return;
      this.lastHover = k;
      this.cb.onHover(pick, pick ? { x: clientX - rect.left, y: clientY - rect.top } : null);
    });
  };

  private readonly onPointerLeave = () => {
    cancelAnimationFrame(this.hoverFrame);
    this.lastHover = null;
    this.cb.onHover(null, null);
  };

  private hit(e: { clientX: number; clientY: number }): Pick | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.pickables, ...this.blockers], true);
    for (const h of hits) {
      let o: Object3D | null = h.object;
      while (o && !o.userData.key) o = o.parent;
      if (!o) continue;
      if (o.userData.key === 'env') return null;
      const p = this.desc?.primitives.find((x) => x.key === o!.userData.key)?.pick;
      if (p) return p;
    }
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Primitivas

function bodyMaterial(st: Style): Material {
  const color = new Color(st.color);
  if (st.look === 'off' || st.look === 'ghost') {
    const m = new MeshStandardMaterial({ color, transparent: true, opacity: st.opacity, depthWrite: false, roughness: 0.7, metalness: 0.05, side: DoubleSide });
    if (st.emphasis === 'hover') m.emissive = color.clone().multiplyScalar(0.3);
    if (st.emphasis === 'selected' && st.edge) m.emissive = new Color(st.edge).multiplyScalar(0.25);
    return m;
  }
  const m = new MeshStandardMaterial({ color, roughness: st.look === 'metal' ? 0.35 : 0.5, metalness: st.look === 'metal' ? 0.55 : 0.25 });
  if (st.emphasis === 'hover') m.emissive = color.clone().multiplyScalar(0.35);
  if (st.emphasis === 'selected' && st.edge) m.emissive = new Color(st.edge).multiplyScalar(0.12);
  return m;
}

function primitive(p: ScenePrimitive): Object3D {
  const mat = bodyMaterial(p.style);
  let mesh: Mesh;
  switch (p.kind) {
    case 'cylinder': {
      mesh = new Mesh(new CylinderGeometry(p.radius, p.radius, p.y1 - p.y0, 40), mat);
      mesh.position.set(p.center[0], (p.y0 + p.y1) / 2, p.center[1]);
      break;
    }
    case 'pad':
      mesh = new Mesh(sectorSolid(p.rInner, p.rOuter, p.azimuth - p.halfAngle, p.azimuth + p.halfAngle, p.y0, p.y1), mat);
      break;
    case 'rod':
      mesh = rodMesh(p.from, p.to, p.radius, mat);
      break;
    case 'bow': {
      const [dx, dz] = dir(p.azimuth);
      const pts: Vector3[] = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const r = p.rIn + (p.rOut - p.rIn) * Math.sin(Math.PI * t);
        pts.push(new Vector3(p.center[0] + dx * r, p.y1 - (p.y1 - p.y0) * t, p.center[1] + dz * r));
      }
      mesh = new Mesh(new TubeGeometry(new CatmullRomCurve3(pts), 24, p.radius, 6, false), mat);
      break;
    }
    case 'ring': {
      mesh = new Mesh(new CylinderGeometry(p.radius, p.radius, p.height, 40), mat);
      mesh.position.set(p.center[0], p.y, p.center[1]);
      break;
    }
  }
  if (p.style.look === 'off' || p.style.look === 'ghost') mesh.renderOrder = 2;
  if (!p.style.edge) return mesh;
  // Contorno: bordes arriba y abajo y cuatro generatrices; punteado en la planificada sin datos, continuo al seleccionar.
  const g = new Group();
  g.add(mesh);
  if (p.kind === 'cylinder') {
    const edgeMat =
      p.style.look === 'ghost'
        ? new LineDashedMaterial({ color: new Color(p.style.edge), dashSize: 1.6, gapSize: 1, transparent: true, opacity: 0.95 })
        : new LineBasicMaterial({ color: new Color(p.style.edge), transparent: true, opacity: 0.95 });
    const pts: Vector3[] = [];
    const ring = (y: number) => {
      for (let i = 0; i < 48; i++) {
        const [a, b] = [(i / 48) * Math.PI * 2, ((i + 1) / 48) * Math.PI * 2];
        pts.push(new Vector3(p.center[0] + Math.sin(a) * p.radius, y, p.center[1] + Math.cos(a) * p.radius), new Vector3(p.center[0] + Math.sin(b) * p.radius, y, p.center[1] + Math.cos(b) * p.radius));
      }
    };
    ring(p.y0);
    ring(p.y1);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      pts.push(new Vector3(p.center[0] + Math.sin(a) * p.radius, p.y0, p.center[1] + Math.cos(a) * p.radius), new Vector3(p.center[0] + Math.sin(a) * p.radius, p.y1, p.center[1] + Math.cos(a) * p.radius));
    }
    const lines = new LineSegments(new BufferGeometry().setFromPoints(pts), edgeMat);
    lines.computeLineDistances();
    lines.raycast = () => {};
    g.add(lines);
  }
  return g;
}

/** Cáscara de una curva: pared cilíndrica en el cuarto recortado, tapas desde la pared y bordes marcados. */
function shell(s: ShellPrimitive, order: number): Object3D {
  const g = new Group();
  const color = new Color(s.color);
  const [w0, wl] = [0, Math.PI / 2];
  const H = s.y1 - s.y0;
  const side = new Mesh(
    new CylinderGeometry(s.radius, s.radius, H, 48, 1, true, w0, wl),
    new MeshBasicMaterial({ color, transparent: true, opacity: s.opacity, depthWrite: false, side: DoubleSide }),
  );
  side.position.y = (s.y0 + s.y1) / 2;
  const capMat = new MeshBasicMaterial({ color, transparent: true, opacity: s.opacity * 0.7, depthWrite: false, side: DoubleSide });
  const top = new Mesh(annularSector(s.rWall, s.radius, w0, w0 + wl, s.y1, 40), capMat);
  const bottom = new Mesh(annularSector(s.rWall, s.radius, w0, w0 + wl, s.y0, 40), capMat);
  // Bordes: arco de arriba y de abajo y las trazas sobre las dos caras del corte. Punteados si el dato es aproximado.
  const edgeMat = s.unverified
    ? new LineDashedMaterial({ color, dashSize: 2.2, gapSize: 1.4, transparent: true, opacity: 0.95 })
    : new LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
  const pts: Vector3[] = [];
  for (const y of [s.y0, s.y1]) {
    for (let i = 0; i < 32; i++) {
      const a = w0 + (wl * i) / 32;
      const b = w0 + (wl * (i + 1)) / 32;
      pts.push(new Vector3(Math.sin(a) * s.radius, y, Math.cos(a) * s.radius), new Vector3(Math.sin(b) * s.radius, y, Math.cos(b) * s.radius));
    }
  }
  for (const a of [w0, w0 + wl]) pts.push(new Vector3(Math.sin(a) * s.radius, s.y0, Math.cos(a) * s.radius), new Vector3(Math.sin(a) * s.radius, s.y1, Math.cos(a) * s.radius));
  const edges = new LineSegments(new BufferGeometry().setFromPoints(pts), edgeMat);
  if (s.unverified) edges.computeLineDistances();
  for (const m of [side, top, bottom]) m.renderOrder = 3 + order;
  edges.renderOrder = 3 + order;
  g.add(side, top, bottom, edges);
  return g;
}

/** Banda difusa del rango: tapas con degradé de opacidad (máxima en el valor típico). */
function band(b: BandPrimitive): Object3D {
  const g = new Group();
  const mat = new MeshBasicMaterial({ color: new Color(b.color), vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide });
  for (const y of [b.y0, b.y1]) {
    const geo = annularSector(b.rMin, b.rMax, 0, Math.PI / 2, y, 40, 16);
    // Alfa por vértice (color blanco: el color lo da el material).
    const pos = geo.getAttribute('position');
    const col = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      col.set([1, 1, 1, bandAlpha(b, r) * b.opacity], i * 4);
    }
    geo.setAttribute('color', new BufferAttribute(col, 4));
    const m = new Mesh(geo, mat);
    m.renderOrder = 2;
    g.add(m);
  }
  return g;
}

function ruler(r: RulerDesc): Object3D {
  const pts: Vector3[] = [new Vector3(r.rWall, r.y, 0), new Vector3(r.rEnd, r.y, 0)];
  for (const t of r.ticks) pts.push(new Vector3(t.r, r.y, -0.2), new Vector3(t.r, r.y + 5, -0.2));
  const lines = new LineSegments(new BufferGeometry().setFromPoints(pts), new LineBasicMaterial({ color: new Color(r.color) }));
  lines.raycast = () => {};
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------
// Geometrías auxiliares

function rodMesh(from: Vec3, to: Vec3, radius: number, mat: Material): Mesh {
  const a = new Vector3(...from);
  const b = new Vector3(...to);
  const len = Math.max(0.01, a.distanceTo(b));
  const m = new Mesh(new CylinderGeometry(radius, radius, len, 12), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.copy(new Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize()));
  return m;
}

/** Sector anular horizontal a la altura y (θ con la convención de three), con anillos radiales opcionales. */
function annularSector(rIn: number, rOut: number, t0: number, t1: number, y: number, segments: number, rings = 1): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= rings; j++) {
    const r = rIn + ((rOut - rIn) * j) / rings;
    for (let i = 0; i <= segments; i++) {
      const t = t0 + ((t1 - t0) * i) / segments;
      pos.push(Math.sin(t) * r, y, Math.cos(t) * r);
    }
  }
  const row = segments + 1;
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * row + i;
      idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Rectángulo vertical en el ángulo θ, de r0 a r1 y de y0 a y1, con UV (v a lo alto, para la textura de estratos). */
function radialQuad(theta: number, r0: number, r1: number, y0: number, y1: number): BufferGeometry {
  const [dx, dz] = dir(theta);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([dx * r0, y0, dz * r0, dx * r1, y0, dz * r1, dx * r1, y1, dz * r1, dx * r0, y1, dz * r0]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

/** Sólido de sector anular (patín): forma en el plano y extrusión vertical. */
function sectorSolid(rIn: number, rOut: number, t0: number, t1: number, y0: number, y1: number): BufferGeometry {
  // Punto de la forma (sx, sy) → después de rotar −90° en x: (sx, profundidad, −sy). Para la dirección (sin θ, cos θ)
  // en (x, z) la forma usa (sin θ, −cos θ).
  const shape = new Shape();
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    const [x, y] = [Math.sin(t) * rOut, -Math.cos(t) * rOut];
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  for (let i = n; i >= 0; i--) {
    const t = t0 + ((t1 - t0) * i) / n;
    shape.lineTo(Math.sin(t) * rIn, -Math.cos(t) * rIn);
  }
  const g = new ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

function edgeOf(theta: number, env: EnvironmentDesc): Vector3[] {
  const [dx, dz] = dir(theta);
  const p = (r: number, y: number) => new Vector3(dx * r, y, dz * r);
  return [p(env.rWall, env.y1), p(env.rOuter, env.y1), p(env.rOuter, env.y1), p(env.rOuter, env.y0), p(env.rWall, env.y0), p(env.rWall, env.y1)];
}

function mixHex(a: string, b: string, t: number): string {
  return `#${new Color(a).lerp(new Color(b), t).getHexString()}`;
}

function disposeObject(o: Object3D): void {
  o.traverse((x) => {
    const m = x as Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (m as { material?: Material | Material[] }).material;
    for (const y of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      // Las texturas no se liberan con el material (estratos de la formación).
      (y as MeshStandardMaterial).map?.dispose();
      y.dispose();
    }
  });
}

