/**
 * Dibujo WebGL de la escena de la sarta (docs/decisiones/0033, D3–D4 y D9): traduce la descripción pura de `scene.ts`
 * a mallas de three.js. No decide nada de geometría ni de estados: materiales, luces, texturas procedurales, cámara e
 * interacción.
 *
 * - Ilustración técnica (D9): acero con reflejos de un ambiente generado en código (`RoomEnvironment` + PMREM, sin
 *   imágenes), luz principal con sombras suaves, tone mapping ACES y salida sRGB; cáscaras de vidrio (fresnel);
 *   formación con texturas procedurales hechas en un canvas a partir de sus capas.
 * - Render a demanda: se dibuja cuando cambian la cámara (evento `change` de los controles), la escena o el tamaño
 *   (`ResizeObserver`). El único bucle es el de la animación de «Vista inicial» (sin animación con movimiento reducido).
 *   El mapa de sombras se recalcula solo cuando cambia algún objeto (la luz está fija en la escena).
 * - Reutiliza por clave: un objeto se reconstruye solo si su primitiva cambió (al pasar el puntero cambian 2–5 piezas).
 * - Rótulos en HTML (nítidos, con los tokens del CSS) sobre el lienzo, reposicionados en cada cuadro.
 * - `dispose()` libera geometrías, materiales, texturas, el ambiente, controles y el contexto.
 * - Extensible (docs/decisiones/0065): la pantalla de Inicio hereda esta clase (`src/app/home/showcase3d.ts`) con
 *   `RendererOptions` (sin regla, cáscaras ni rótulos; fondo transparente; sin sombras) y mueve el grupo `content`.
 */
import {
  ACESFilmicToneMapping,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  type Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  Shape,
  Spherical,
  SRGBColorSpace,
  type Texture,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { parseHex } from '../../ui/color';
import { bandAlpha, dir, initialCamera, type BandPrimitive, type EnvironmentDesc, type Pick, type RulerDesc, type ScenePrimitive, type ShellPrimitive, type Style, type ToolStringScene, type Vec3 } from './scene';

export interface RendererCallbacks {
  /** Pieza bajo el puntero (null = ninguna), con la posición del puntero relativa al contenedor. */
  onHover(pick: Pick | null, at: { x: number; y: number } | null): void;
  /** Clic sin arrastre: pieza tocada o null (vacío). */
  onPick(pick: Pick | null): void;
  /** El navegador perdió el contexto WebGL (la vista deja de dibujar: quien la usa muestra la alternativa). */
  onContextLost?(): void;
}

/** Variantes del dibujo (por defecto, la vista del configurador). */
export interface RendererOptions {
  /** Partes opcionales de la escena: regla, cáscaras con sus bandas y rótulos (por defecto, todas). */
  parts?: { ruler?: boolean; shells?: boolean; labels?: boolean };
  /** Tope de la densidad de píxeles (por defecto 2). */
  maxPixelRatio?: number;
  antialias?: boolean;
  shadows?: boolean;
  /** Fondo transparente: lo pinta el CSS de quien la usa. */
  transparent?: boolean;
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

/** Campo vertical de la cámara: cerrado, para una perspectiva de render de producto (poca distorsión). */
const FOV = 26;
const UP = new Vector3(0, 1, 0);
/** Dirección de la luz principal (arriba a la izquierda de la cámara inicial: la sombra de la sarta cae en la pared). */
const KEY_DIR = new Vector3(0.42, 1.05, 0.95).normalize();

/** Clave de reutilización: la primitiva entera (si cambia algo, se reconstruye ese objeto). */
const sig = (x: unknown) => JSON.stringify(x);

export class ToolStringRenderer {
  protected readonly renderer: WebGLRenderer;
  protected readonly scene = new Scene();
  /** Todo lo que describe la escena cuelga de este grupo (Inicio lo gira y lo acuesta; acá queda en el origen). */
  protected readonly content = new Group();
  protected readonly camera = new PerspectiveCamera(FOV, 1, 1, 30000);
  protected readonly controls: OrbitControls;
  protected readonly key: DirectionalLight;
  protected readonly rim: DirectionalLight;
  protected readonly fill: HemisphereLight;
  private readonly envMap: Texture;
  protected readonly objects = new Map<string, { object: Object3D; sig: string }>();
  private readonly pickables: Object3D[] = [];
  private readonly blockers: Object3D[] = [];
  private readonly labelsLayer: HTMLDivElement;
  private labels: { el: HTMLSpanElement; pos: Vector3; kind: string; w: number; h: number }[] = [];
  private readonly ro: ResizeObserver;
  private readonly raycaster = new Raycaster();
  protected desc: ToolStringScene | null = null;
  private frame = 0;
  private tween = 0;
  private hoverFrame = 0;
  protected size = { w: 1, h: 1 };
  private down: { x: number; y: number } | null = null;
  private lastHover: string | null = null;
  protected disposed = false;
  /** La usuaria movió la cámara desde la última vista inicial (entonces no se reencuadra sola). */
  protected userMoved = false;
  private boundsSig = '';
  private readonly parts: Required<NonNullable<RendererOptions['parts']>>;
  private readonly transparent: boolean;

  constructor(
    protected readonly container: HTMLElement,
    protected readonly cb: RendererCallbacks,
    protected readonly reducedMotion: () => boolean,
    options: RendererOptions = {},
  ) {
    this.parts = { ruler: true, shells: true, labels: true, ...options.parts };
    this.transparent = !!options.transparent;
    this.renderer = new WebGLRenderer({ antialias: options.antialias ?? true, alpha: this.transparent, powerPreference: 'default' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, options.maxPixelRatio ?? 2));
    if (this.transparent) this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = options.shadows ?? true;
    this.renderer.shadowMap.type = PCFShadowMap;
    // La luz está fija en la escena: las sombras no cambian al mover la cámara (se piden en `setScene`).
    this.renderer.shadowMap.autoUpdate = false;
    const canvas = this.renderer.domElement;
    canvas.className = 'ts3d__canvas';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.labelsLayer = document.createElement('div');
    this.labelsLayer.className = 'ts3d__labels';
    this.labelsLayer.setAttribute('aria-hidden', 'true');
    container.appendChild(this.labelsLayer);

    // Ambiente generado en código (una habitación con luces de área): reflejos del acero sin imágenes externas.
    const pmrem = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.envMap = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.75;

    this.scene.add(this.content);
    this.fill = new HemisphereLight(0xffffff, 0x8a7a66, 0.55);
    this.scene.add(this.fill);
    this.key = new DirectionalLight(0xffffff, 2.1);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.radius = 5;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.6;
    this.scene.add(this.key, this.key.target);
    this.rim = new DirectionalLight(0xdfe8ff, 0.55);
    this.rim.position.set(-300, 160, -260);
    this.scene.add(this.rim);

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
    const bs = sig(desc.focus);
    const grew = bs !== this.boundsSig;
    this.boundsSig = bs;
    this.desc = desc;
    this.scene.background = this.transparent ? null : new Color(background);
    let changed = false;
    const seen = new Set<string>();
    const put = (key: string, value: unknown, make: () => Object3D, pickable = false, blocker = false) => {
      seen.add(key);
      const s = sig(value);
      const prev = this.objects.get(key);
      if (prev && prev.sig === s) return;
      if (prev) this.remove(key, prev.object);
      const object = make();
      object.userData.key = key;
      this.content.add(object);
      this.objects.set(key, { object, sig: s });
      if (pickable) this.pickables.push(object);
      if (blocker) this.blockers.push(object);
      changed = true;
    };
    put('env', desc.environment, () => environment(desc.environment), false, true);
    if (this.parts.ruler) put('ruler', desc.ruler, () => ruler(desc.ruler));
    for (const p of desc.primitives) put(p.key, p, () => primitive(p), !!p.pick);
    if (this.parts.shells) {
      // Cáscaras: de afuera hacia adentro (las de adentro se ven a través de las de afuera).
      const shells = [...desc.shells].sort((a, b) => b.radius - a.radius);
      shells.forEach((s, i) => put(s.key, { s, i }, () => shell(s, i)));
      for (const b of desc.bands) put(b.key, b, () => band(b));
    }
    for (const [key, { object }] of [...this.objects]) {
      if (seen.has(key)) continue;
      this.remove(key, object);
      changed = true;
    }
    if (changed) {
      this.placeKeyLight(desc);
      this.renderer.shadowMap.needsUpdate = true;
    }
    if (this.parts.labels) this.buildLabels(desc);
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
   * está del otro lado). Solo con el botón «Centrar en la vista»: seleccionar no mueve la cámara (0033 D9 c).
   */
  focusTool(toolId: string): void {
    const d = this.desc;
    const t = d?.tools.find((x) => x.toolId === toolId);
    if (!d || !t) return;
    const reach = Math.max(d.environment.rWall * 7, ...d.shells.filter((s) => s.toolId === toolId).map((s) => s.radius), ...d.bands.filter((b) => b.toolId === toolId).map((b) => b.rMax));
    const target = new Vector3(reach * 0.2 * Math.SQRT1_2, (t.y0 + t.y1) / 2, reach * 0.2 * Math.SQRT1_2);
    const dirv = this.camera.position.clone().sub(this.controls.target).normalize();
    // Del lado del corte (θ entre 0 y π/2 mira a +x, +z): si no, una vista de 3/4 sobre el corte.
    if (dirv.x < 0.15 || dirv.z < 0.15) dirv.set(0.8, 0.45, 0.55).normalize();
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
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    this.controls.removeEventListener('change', this.requestRender);
    this.controls.removeEventListener('start', this.onControlStart);
    this.controls.dispose();
    for (const [key, { object }] of [...this.objects]) this.remove(key, object);
    this.key.shadow.dispose();
    this.envMap.dispose();
    this.scene.environment = null;
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    canvas.remove();
    this.labelsLayer.remove();
  }

  // ------------------------------------------------------------------------------------------------------------
  // Dibujo

  protected readonly requestRender = () => {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  };

  /** Dibuja un cuadro ya (los bucles de animación de las clases hijas lo llaman en su propio cuadro). */
  protected draw(): void {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
  }

  /** Luz principal y su cámara de sombras: cubren la sarta y la formación cercana. */
  protected placeKeyLight(desc: ToolStringScene): void {
    const { min, max } = desc.bounds;
    const center = new Vector3(0, (min[1] + max[1]) / 2, 0);
    const half = Math.max(max[1] - min[1], (max[0] - min[0]) * 0.8) / 2 + 20;
    this.key.target.position.copy(center);
    this.key.position.copy(center).addScaledVector(KEY_DIR, half * 3);
    const cam = this.key.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = half * 6;
    cam.updateProjectionMatrix();
    this.key.target.updateMatrixWorld();
  }

  protected resize(): void {
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
    this.content.remove(object);
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
      el.className = `ts3d__label ts3d__label--${l.kind}${l.muted ? ' is-muted' : ''}`;
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

  // ------------------------------------------------------------------------------------------------------------
  // Puntero

  private readonly onContextLost = (e: Event) => {
    // Sin `preventDefault`: no se intenta recuperar el contexto; quien usa la vista muestra su alternativa.
    void e;
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.tween);
    this.frame = this.tween = 0;
    this.cb.onContextLost?.();
  };

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
// Materiales

/**
 * Vidrio con borde (fresnel): la opacidad va de `center` (mirando de frente) a `rim` (de canto). Sirve para las
 * cáscaras, el contorno de una herramienta planificada sin datos y el aro de la seleccionada. Sin tone mapping: el color
 * es el de la curva o del acento, tal cual.
 */
function fresnel(color: string, center: number, rim: number, power = 2.2): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uCenter: { value: center }, uRim: { value: rim }, uPower: { value: power } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uCenter;
      uniform float uRim;
      uniform float uPower;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPower);
        gl_FragColor = linearToOutputTexel(vec4(uColor, mix(uCenter, uRim, f)));
      }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  });
}

/** Acero: metálico con reflejos del ambiente. */
const steel = (color: string, roughness = 0.3) => new MeshStandardMaterial({ color: new Color(color), metalness: 0.88, roughness });

/** Material de una pieza según su aspecto (el cuerpo de una herramienta prendida lo arma `toolBody`). */
function pieceMaterial(st: Style, kind: ScenePrimitive['kind']): Material {
  const color = new Color(st.color);
  let m: MeshStandardMaterial;
  if (st.look === 'ghost') {
    return new MeshBasicMaterial({ color: new Color(st.edge ?? st.color), transparent: true, opacity: 0.32, depthWrite: false });
  } else if (st.look === 'off') {
    m = new MeshStandardMaterial({ color, metalness: 0, roughness: 0.92, envMapIntensity: 0.5 });
  } else if (kind === 'pad' && st.look === 'on') {
    // Patines y zapatas: polímero oscuro, satinado.
    m = new MeshStandardMaterial({ color, metalness: 0.15, roughness: 0.5 });
  } else {
    m = steel(st.color, st.look === 'metal' ? 0.28 : 0.34);
  }
  if (st.emphasis === 'hover') m.emissive = new Color(0xffffff).multiplyScalar(0.1);
  if (st.emphasis === 'selected' && st.edge) m.emissive = new Color(st.edge).multiplyScalar(0.28);
  return m;
}

// ---------------------------------------------------------------------------------------------------------------
// Primitivas

function primitive(p: ScenePrimitive): Object3D {
  if (p.kind === 'cylinder' && p.detail) return turned(p);
  const mat = pieceMaterial(p.style, p.kind);
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
  if (p.style.look === 'ghost') mesh.renderOrder = 2;
  else mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/**
 * Cuerpo torneado: herramienta (chaflanes, collares en las uniones y dos anillos del color de la familia) o cabeza
 * (cuello de pesca arriba). Prendida: acero; apagada: gris mate; planificada sin datos: contorno de vidrio con anillos
 * punteados. Seleccionada: un aro de luz del color de acento alrededor de la silueta.
 */
function turned(p: Extract<ScenePrimitive, { kind: 'cylinder' }>): Object3D {
  const g = new Group();
  const st = p.style;
  const r = p.radius;
  const H = p.y1 - p.y0;
  const [cx, cz] = p.center;
  const at = (m: Mesh, y: number) => {
    m.position.set(cx, y, cz);
    if (st.look !== 'ghost') m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const ch = Math.min(r * 0.4, H * 0.08);
  const neck = p.detail === 'head' ? Math.min(H * 0.35, 9) : ch;

  if (st.look === 'ghost') {
    // Contorno de vidrio: la silueta se marca desde cualquier ángulo; anillos punteados en los extremos.
    const edge = st.edge ?? st.color;
    at(new Mesh(new CylinderGeometry(r, r, H, 40, 1, true), fresnel(edge, 0.04, 0.8, 2.6)), (p.y0 + p.y1) / 2).renderOrder = 2;
    const pts: Vector3[] = [];
    const ring = (y: number, rr: number) => {
      for (let i = 0; i < 48; i++) {
        const [a, b] = [(i / 48) * Math.PI * 2, ((i + 1) / 48) * Math.PI * 2];
        pts.push(new Vector3(cx + Math.sin(a) * rr, y, cz + Math.cos(a) * rr), new Vector3(cx + Math.sin(b) * rr, y, cz + Math.cos(b) * rr));
      }
    };
    ring(p.y0, r);
    ring(p.y1, r);
    const lines = new LineSegments(new BufferGeometry().setFromPoints(pts), new LineDashedMaterial({ color: new Color(edge), dashSize: 1.4, gapSize: 1, transparent: true, opacity: 0.95, toneMapped: false }));
    lines.computeLineDistances();
    lines.raycast = () => {};
    g.add(lines);
    // Anillos identificadores, tenues.
    if (p.detail === 'tool') for (const y of idRingYs(p.y0, p.y1, ch)) at(new Mesh(new CylinderGeometry(r * 1.01, r * 1.01, ringHeight(H), 40, 1, true), fresnel(st.color, 0.12, 0.7, 1.4)), y).renderOrder = 2;
  } else {
    const bodyColor = st.look === 'on' ? (st.base ?? st.color) : st.color;
    const body = st.look === 'off' ? new MeshStandardMaterial({ color: new Color(bodyColor), metalness: 0, roughness: 0.92, envMapIntensity: 0.45 }) : steel(bodyColor, st.look === 'metal' ? 0.28 : 0.34);
    if (st.emphasis === 'hover') body.emissive = new Color(0xffffff).multiplyScalar(st.look === 'off' ? 0.06 : 0.1);
    // Las piezas de un mismo material se funden en una sola malla (menos llamadas de dibujo por herramienta).
    const parts = new Map<Material, BufferGeometry[]>();
    const add = (geo: BufferGeometry, y: number, mat: Material) => {
      geo.translate(0, y, 0);
      parts.set(mat, [...(parts.get(mat) ?? []), geo]);
    };
    // Fuste y chaflanes (troncos de cono con sus propias normales: aristas nítidas).
    add(new CylinderGeometry(r, r, H - ch - neck, 48), p.y0 + ch + (H - ch - neck) / 2, body);
    add(new CylinderGeometry(r, r * 0.62, ch, 48), p.y0 + ch / 2, body);
    if (p.detail === 'head') {
      // Cuello de pesca: cono, garganta y botón.
      add(new CylinderGeometry(r * 0.5, r, neck * 0.55, 48), p.y1 - neck + (neck * 0.55) / 2, body);
      add(new CylinderGeometry(r * 0.38, r * 0.38, neck * 0.25, 32), p.y1 - neck * 0.45 + (neck * 0.25) / 2, body);
      add(new CylinderGeometry(r * 0.5, r * 0.5, neck * 0.2, 32), p.y1 - (neck * 0.2) / 2, body);
    } else {
      add(new CylinderGeometry(r * 0.62, r, ch, 48), p.y1 - ch / 2, body);
      // Collares en las uniones, más oscuros.
      const collar = st.look === 'off' ? body : steel(new Color(bodyColor).multiplyScalar(0.62).getStyle(), 0.24);
      for (const y of [p.y0 + ch + 0.6, p.y1 - ch - 0.6]) add(new CylinderGeometry(r * 1.025, r * 1.025, 1.2, 48), y, collar);
      // Anillos identificadores: el color de la familia (anodizado), o un gris más oscuro si está apagada.
      const ringColor = st.look === 'off' ? new Color(st.color).multiplyScalar(0.78) : new Color(st.color);
      const ringMat = new MeshStandardMaterial({ color: ringColor, metalness: st.look === 'off' ? 0 : 0.35, roughness: st.look === 'off' ? 0.9 : 0.38 });
      if (st.look === 'on') ringMat.emissive = ringColor.clone().multiplyScalar(st.emphasis === 'hover' ? 0.35 : 0.14);
      for (const y of idRingYs(p.y0, p.y1, ch)) add(new CylinderGeometry(r * 1.018, r * 1.018, ringHeight(H), 48), y, ringMat);
    }
    for (const [mat, geos] of parts) {
      const merged = mergeGeometries(geos);
      for (const geo of geos) geo.dispose();
      if (merged) at(new Mesh(merged, mat), 0);
    }
  }
  if (st.emphasis === 'selected' && st.edge) {
    // Aro de selección: una funda de vidrio del color de acento, más ancha que la pieza, que se marca en la silueta.
    const rh = r * 1.3 + 1.4;
    const halo = new Mesh(new CylinderGeometry(rh, rh, H + 2.5, 40, 1, true), fresnel(st.edge, 0.03, 0.8, 2.2));
    halo.renderOrder = 20;
    halo.raycast = () => {};
    at(halo, (p.y0 + p.y1) / 2).castShadow = false;
    halo.receiveShadow = false;
  }
  return g;
}

const ringHeight = (H: number) => Math.min(4.5, H * 0.1);
/** Alturas de los anillos identificadores: cerca de cada extremo, dentro del fuste. */
function idRingYs(y0: number, y1: number, ch: number): number[] {
  const H = y1 - y0;
  const h = ringHeight(H);
  const off = ch + 1.2 + 1.6 + h / 2;
  return H > 4 * off ? [y1 - off, y0 + off] : [(y0 + y1) / 2];
}

/**
 * Cáscara de una curva: pared cilíndrica de vidrio en el cuarto recortado (borde más marcado que el centro), contorno
 * arriba y abajo y trazas sobre las dos caras del corte. Las de la herramienta seleccionada pintan además, muy suave,
 * la porción de formación que investigan sobre las caras. Punteadas si el dato es aproximado o la curva no está.
 */
function shell(s: ShellPrimitive, order: number): Object3D {
  const g = new Group();
  const [w0, wl] = [0, Math.PI / 2];
  const H = s.y1 - s.y0;
  const ro = 3 + order;
  if (s.rim > 0.005) {
    const side = new Mesh(new CylinderGeometry(s.radius, s.radius, H, 64, 1, true, w0, wl), fresnel(s.color, s.opacity, s.rim, 2.4));
    side.position.y = (s.y0 + s.y1) / 2;
    side.renderOrder = ro;
    g.add(side);
  }
  if (s.emphasis === 'strong') {
    // Lo que la curva investiga, sobre las caras del corte: se acumula hacia la pared, donde leen todas.
    const mat = new MeshBasicMaterial({ color: new Color(s.color), transparent: true, opacity: s.opacity * 0.6, depthWrite: false, side: DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (const a of [w0, w0 + wl]) {
      const m = new Mesh(radialQuad(a, s.rWall, s.radius, s.y0, s.y1), mat);
      m.renderOrder = ro;
      g.add(m);
    }
  }
  const dashed = s.unverified || !s.present;
  const edgeMat = dashed
    ? new LineDashedMaterial({ color: new Color(s.color), dashSize: 2.2, gapSize: 1.6, transparent: true, opacity: s.line, toneMapped: false, depthWrite: false })
    : new LineBasicMaterial({ color: new Color(s.color), transparent: true, opacity: s.line, toneMapped: false, depthWrite: false });
  const pts: Vector3[] = [];
  for (const y of [s.y0, s.y1]) {
    for (let i = 0; i < 40; i++) {
      const a = w0 + (wl * i) / 40;
      const b = w0 + (wl * (i + 1)) / 40;
      pts.push(new Vector3(Math.sin(a) * s.radius, y, Math.cos(a) * s.radius), new Vector3(Math.sin(b) * s.radius, y, Math.cos(b) * s.radius));
    }
  }
  for (const a of [w0, w0 + wl]) pts.push(new Vector3(Math.sin(a) * s.radius, s.y0, Math.cos(a) * s.radius), new Vector3(Math.sin(a) * s.radius, s.y1, Math.cos(a) * s.radius));
  const edges = new LineSegments(new BufferGeometry().setFromPoints(pts), edgeMat);
  if (dashed) edges.computeLineDistances();
  edges.renderOrder = ro;
  g.add(edges);
  g.traverse((o) => (o.raycast = () => {}));
  return g;
}

/** Banda difusa del rango: tapas con degradé de opacidad (máxima en el valor típico). */
function band(b: BandPrimitive): Object3D {
  const g = new Group();
  const mat = new MeshBasicMaterial({ color: new Color(b.color), vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide, toneMapped: false });
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
    m.raycast = () => {};
    g.add(m);
  }
  return g;
}

function ruler(r: RulerDesc): Object3D {
  // Sobre la cara del corte en θ = 0 (plano x = 0, hacia +z), apenas delante de ella.
  const x = 0.3;
  const pts: Vector3[] = [new Vector3(x, r.y, r.rWall), new Vector3(x, r.y, r.rEnd)];
  for (const t of r.ticks) pts.push(new Vector3(x, r.y, t.r), new Vector3(x, r.y + 5, t.r));
  const lines = new LineSegments(new BufferGeometry().setFromPoints(pts), new LineBasicMaterial({ color: new Color(r.color), toneMapped: false }));
  lines.raycast = () => {};
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------
// Formación

/**
 * Formación en corte (D9): las dos caras del corte y la tapa, con la textura de sus capas y desvanecidas hacia el borde
 * exterior y hacia abajo; la pared del pozo con el revoque en las capas permeables; lodo y cable.
 */
function environment(env: EnvironmentDesc): Object3D {
  const g = new Group();
  const H = env.y1 - env.y0;
  const ym = (env.y0 + env.y1) / 2;
  const [w0, wl] = env.wedge;
  const restStart = w0 + wl;
  const restLen = Math.PI * 2 - wl;

  // El color del material oscurece un poco la textura: la formación no compite en brillo con la sarta.
  // Lambert (difuso, sin PBR): la roca no necesita reflejos y estas caras cubren media pantalla; es el material más barato
  // que recibe sombras.
  const faceMat = new MeshLambertMaterial({ map: faceTexture(env), color: new Color(0.8, 0.8, 0.8), transparent: true, side: DoubleSide });
  const cutA = new Mesh(radialQuad(w0, env.rWall, env.rOuter, env.y0, env.y1), faceMat);
  const cutB = new Mesh(radialQuad(w0 + wl, env.rWall, env.rOuter, env.y0, env.y1), faceMat);
  const wallTex = wallTexture(env);
  wallTex.repeat.set(5, 1);
  const wall = new Mesh(new CylinderGeometry(env.rWall, env.rWall, H, 64, 1, true, restStart, restLen), new MeshLambertMaterial({ map: wallTex, transparent: true, side: BackSide }));
  wall.position.y = ym;
  // Tapa: el color de la capa de arriba, desvanecida hacia el borde exterior.
  const top = topCap(env, restStart, restLen);
  // Solo la pared del pozo recibe sombras (la de la sarta cae ahí): las caras del corte cubren media pantalla y el
  // filtrado de sombras en cada píxel sería el costo más grande del cuadro.
  wall.receiveShadow = true;
  for (const m of [cutA, cutB, wall, top]) m.renderOrder = 0;
  // Lodo: caras del corte y superficie, translúcidas (sin escribir profundidad: no tapan la sarta).
  const mudMat = new MeshBasicMaterial({ color: new Color(env.colors.mud), transparent: true, opacity: 0.1, depthWrite: false, side: DoubleSide, toneMapped: false });
  const mudA = new Mesh(radialQuad(w0, 0, env.rWall, env.y0, env.y1), mudMat);
  const mudB = new Mesh(radialQuad(w0 + wl, 0, env.rWall, env.y0, env.y1), mudMat);
  const mudTop = new Mesh(annularSector(0.01, env.rWall, restStart, restStart + restLen, env.y1 - 0.4, 48), mudMat);
  mudA.renderOrder = mudB.renderOrder = mudTop.renderOrder = 1;
  const c = env.cable;
  const cable = rodMesh(c.from, c.to, c.radius, new MeshStandardMaterial({ color: new Color(c.color), roughness: 0.55, metalness: 0.3 }));
  cable.castShadow = true;
  g.add(cutA, cutB, wall, top, mudA, mudB, mudTop, cable);
  // Lo transparente no bloquea la selección.
  for (const m of [mudA, mudB, mudTop, cable]) m.raycast = () => {};
  return g;
}

/** Generador pseudoaleatorio con semilla fija (la formación sale siempre igual). */
function rng(seed: number): () => number {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/** Ruido de valor suave en [−1, 1] sobre una grilla de 64×64 (bilineal, periódico). */
function valueNoise(seed: number): (x: number, y: number) => number {
  const N = 64;
  const r = rng(seed);
  const grid = Float32Array.from({ length: N * N }, () => r() * 2 - 1);
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (i: number, j: number) => grid[(((j % N) + N) % N) * N + (((i % N) + N) % N)]!;
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
    return a + (b - a) * sy;
  };
}

/** Hash entero → [0, 1) (para granos y juntas sin guardar una tabla). */
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Componentes sRGB 0–255 de un color (el canvas trabaja en sRGB; `Color` de three guarda lineal). */
const rgb = (hex: string): [number, number, number] => {
  const [r, g, b] = parseHex(hex);
  return [r, g, b];
};
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Capa de cada fila del canvas (fila 0 = arriba). */
function rowStrata(env: EnvironmentDesc, rows: number): Int32Array {
  const out = new Int32Array(rows);
  const H = env.y1 - env.y0;
  let k = 0;
  for (let row = 0; row < rows; row++) {
    const y = env.y1 - ((row + 0.5) / rows) * H;
    while (k < env.strata.length - 1 && y < env.strata[k]!.y0) k++;
    out[row] = k;
  }
  return out;
}

/**
 * Textura de las caras del corte: ancho = radio (de la pared al borde exterior), alto = profundidad. Cada capa con el
 * dibujo de su litología, una línea fina en cada contacto, revoque y zona invadida contra la pared en las permeables, y
 * el canal alfa que desvanece la formación hacia afuera y hacia abajo.
 */
function faceTexture(env: EnvironmentDesc): CanvasTexture {
  const W = 768;
  const H = Math.max(256, Math.min(2048, Math.round((env.y1 - env.y0) * 2)));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const px = img.data;
  const rows = rowStrata(env, H);
  const cols = env.strata.map((s) => rgb(s.color));
  const filtrate = rgb(env.colors.filtrate);
  const cake = rgb(env.colors.mudcake);
  const bg = rgb(env.colors.bg);
  const noise = valueNoise(3);
  const span = env.rOuter - env.rWall;
  const pxPerCm = W / span;
  const rowsPerUnit = H / (env.y1 - env.y0);
  for (let row = 0; row < H; row++) {
    const k = rows[row]!;
    const st = env.strata[k]!;
    const [r0, g0, b0] = cols[k]!;
    const contact = row > 0 && rows[row - 1] !== k;
    // Fila dentro de la capa (para la laminación) y franja de ladrillos.
    const yUnits = row / rowsPerUnit;
    // Laminación: láminas finas de tono apenas distinto (lutitas).
    const lam = st.pattern === 'shale' ? (hash2(Math.floor(yUnits * 2.4), 7) - 0.5) * 0.08 : 0;
    const course = Math.floor(yUnits / 3.2);
    const bottomFade = 1 - smooth(0.82, 1, row / H);
    for (let x = 0; x < W; x++) {
      const cm = (x + 0.5) / pxPerCm;
      const r = env.rWall + cm;
      let shade = 1 + noise(x / 40, row / 40) * 0.05 + lam;
      switch (st.pattern) {
        case 'sand': {
          // Granos de 2×2 texeles (los de un texel se pierden al alejarse).
          const h = hash2(x >> 1, row >> 1);
          if (h > 0.9) shade -= 0.15;
          else if (h < 0.04) shade += 0.09;
          break;
        }
        case 'shale':
          shade += (hash2(x >> 5, row) - 0.5) * 0.025;
          break;
        case 'carbonate': {
          // Ladrillos: hiladas de 3,2 unidades de alto y 6 cm de largo, trabadas.
          const joint = yUnits - course * 3.2 < 0.3 || (cm + (course % 2) * 3) % 6 < 0.45;
          if (joint) shade -= 0.1;
          break;
        }
        case 'evaporite':
          if ((x + row) % 14 < 1.5) shade -= 0.08;
          break;
        case 'coal':
          shade += (hash2(x, row) - 0.5) * 0.08;
          break;
        default:
          break;
      }
      if (contact) shade -= 0.22;
      let R = r0 * shade;
      let G = g0 * shade;
      let B = b0 * shade;
      if (st.perm > 0.04) {
        // Zona invadida: el filtrado desplaza al fluido de la formación cerca de la pared; se apaga hacia adentro.
        const L = env.invasionCm * st.perm;
        if (cm < L) {
          const t = Math.pow(1 - cm / L, 1.2) * 0.6 * Math.min(1, st.perm * 1.4);
          R += (filtrate[0] - R) * t;
          G += (filtrate[1] - G) * t;
          B += (filtrate[2] - B) * t;
        }
        // Revoque contra la pared (esquemático: ~1,2 cm).
        if (cm < 1.2 * Math.min(1, st.perm + 0.3)) [R, G, B] = cake;
      }
      // Desvanecido hacia el fondo (afuera y abajo): el color tiende al fondo y el alfa a cero.
      const fade = (1 - smooth(env.rFade, env.rOuter, r)) * bottomFade;
      const i = (row * W + x) * 4;
      px[i] = R + (bg[0] - R) * (1 - fade) * 0.4;
      px[i + 1] = G + (bg[1] - G) * (1 - fade) * 0.4;
      px[i + 2] = B + (bg[2] - B) * (1 - fade) * 0.4;
      px[i + 3] = 255 * fade;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Textura de la pared del pozo: la capa (más oscura) y el revoque en las permeables, alrededor y a lo alto. */
function wallTexture(env: EnvironmentDesc): CanvasTexture {
  const W = 64;
  const H = Math.max(256, Math.min(2048, Math.round((env.y1 - env.y0) * 1.6)));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const px = img.data;
  const rows = rowStrata(env, H);
  const cols = env.strata.map((s) => rgb(s.color));
  const cake = rgb(env.colors.mudcake);
  const noise = valueNoise(5);
  for (let row = 0; row < H; row++) {
    const k = rows[row]!;
    const st = env.strata[k]!;
    const base = st.perm > 0.04 ? cake : cols[k]!.map((v) => v * 0.82);
    const fade = 1 - smooth(0.82, 1, row / H);
    for (let x = 0; x < W; x++) {
      const shade = 1 + noise(x / 12, row / 30) * (st.perm > 0.04 ? 0.08 : 0.05);
      const i = (row * W + x) * 4;
      px[i] = base[0]! * shade;
      px[i + 1] = base[1]! * shade;
      px[i + 2] = base[2]! * shade;
      px[i + 3] = 255 * fade;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  return tex;
}

/** Tapa de la formación con el color de la capa de arriba, opaca junto al pozo y desvanecida hacia afuera. */
function topCap(env: EnvironmentDesc, t0: number, len: number): Mesh {
  const rings = 14;
  const geo = annularSector(env.rWall, env.rOuter, t0, t0 + len, env.y1, 120, rings);
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    // Se apaga antes que las caras: de canto y bien iluminada, una tapa ancha se lee como un disco que flota.
    col.set([0.62, 0.62, 0.62, 1 - smooth(env.rWall + (env.rFade - env.rWall) * 0.4, env.rFade, r)], i * 4);
  }
  geo.setAttribute('color', new BufferAttribute(col, 4));
  const topColor = new Color(env.strata[0]?.color ?? env.colors.formationCut).lerp(new Color(env.colors.bg), 0.3);
  return new Mesh(geo, new MeshLambertMaterial({ color: topColor, vertexColors: true, transparent: true, side: DoubleSide }));
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

/** Rectángulo vertical en el ángulo θ, de r0 a r1 y de y0 a y1, con UV (u a lo ancho, v a lo alto). */
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
  const g = new ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.2, bevelSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

function disposeObject(o: Object3D): void {
  o.traverse((x) => {
    const m = x as Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (m as { material?: Material | Material[] }).material;
    for (const y of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      // Las texturas no se liberan con el material (capas de la formación).
      (y as MeshStandardMaterial).map?.dispose();
      y.dispose();
    }
  });
}
