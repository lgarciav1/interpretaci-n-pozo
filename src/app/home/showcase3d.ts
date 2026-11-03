/**
 * La sarta como pieza exhibida en la pantalla de Inicio (docs/decisiones/0065). Hereda el renderizador del configurador
 * (`ToolStringRenderer`, 0033): mismas geometrías, materiales y selección por rayos; acá solo cambian la pose, la
 * cámara, las luces y el bucle.
 *
 * - Pose de exhibición: la sarta acostada, la cabeza a la izquierda (se lee de arriba hacia abajo como un texto),
 *   apenas inclinada. El giro automático es alrededor de su propio eje, muy lento, y se detiene al primer gesto.
 * - Encuadre: la cámara mira al centro de la sarta; un corrimiento de la proyección (`setViewOffset`) la ubica en la
 *   caja que da el CSS (`frame`), así el lienzo ocupa toda la pantalla y la entrada al pozo es continua.
 * - Entrada (`enter`): la sarta se pone vertical, la cámara se acerca a una herramienta desde el lado del corte y la
 *   formación (conceptual, la misma del configurador) aparece alrededor. Una línea de tiempo con una sola curva.
 * - Bucle solo mientras hay giro o entrada, y nunca con la pestaña oculta; al ocultarse a mitad de la entrada, la
 *   entrada termina en el acto (la interfaz no queda esperando un cuadro que no llega).
 */
import { Group, MathUtils, Quaternion, Spherical, Vector3, type Material, type Object3D, type Texture } from 'three';
import { ToolStringRenderer, type RendererCallbacks } from '../toolString/render3d';
import { VIEW_AZIMUTH, dir, type ToolLayout, type ToolStringScene } from '../toolString/scene';

export interface ShowcaseCallbacks extends RendererCallbacks {
  /** Primer gesto sobre la escena (arrastrar, rueda): el giro automático ya se detuvo. */
  onInteract?(): void;
}

export interface ShowcaseOptions {
  /** Escena simple para equipos modestos: sin suavizado de bordes y a 1 píxel por píxel CSS. */
  quality: 'high' | 'low';
  /** Caja donde va la sarta en reposo, en px relativos al contenedor (la deja libre el texto de Inicio). */
  frame: () => { x: number; y: number; w: number; h: number };
}

/** Una vuelta cada 90 s: se percibe que gira, no distrae. */
const SPIN_RAD_PER_S = (Math.PI * 2) / 90;
/** Pose de exhibición (YXZ): acostada con la cabeza a la izquierda, subiendo apenas, y la cabeza hacia la cámara. */
const ELEVATION = MathUtils.degToRad(11);
const FOV = 34;

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Tramo [a, b] de la línea de tiempo llevado a 0–1. */
const span = (k: number, a: number, b: number) => clamp01((k - a) / (b - a));

interface Timeline {
  start: number;
  ms: number;
  apply(k: number): void;
  resolve(): void;
}

export class ShowcaseRenderer extends ToolStringRenderer {
  /** Pose (acostada → vertical) y posición: el centro de la sarta o, al final de la entrada, la herramienta elegida. */
  private readonly pivot = new Group();
  /** Giro alrededor del eje de la sarta. */
  private readonly spin = new Group();
  private loop = 0;
  private last = 0;
  private spinning = false;
  private timeline: Timeline | null = null;
  private envObject: Object3D | null = null;
  /** Opacidad de la formación (0 en reposo, 1 al final de la entrada). */
  private envAmount = 0;
  private offset = { x: 0, y: 0 };
  private interacted = false;
  private pending: Promise<void> | null = null;
  /** El constructor de la clase base ya llama a `resize`, antes de que existan los campos de esta. */
  private ready = false;

  constructor(
    container: HTMLElement,
    private readonly callbacks: ShowcaseCallbacks,
    reducedMotion: () => boolean,
    private readonly opts: ShowcaseOptions,
  ) {
    super(container, callbacks, reducedMotion, {
      parts: { ruler: false, shells: false, labels: false },
      maxPixelRatio: opts.quality === 'low' ? 1 : 1.5,
      antialias: opts.quality !== 'low',
      shadows: false,
      transparent: true,
    });
    this.scene.remove(this.content);
    this.spin.add(this.content);
    this.pivot.add(this.spin);
    this.pivot.quaternion.copy(EXHIBIT_POSE);
    this.scene.add(this.pivot);
    this.camera.fov = FOV;
    this.camera.updateProjectionMatrix();
    this.controls.enablePan = false;
    this.controls.zoomToCursor = false;
    this.controls.addEventListener('start', this.onStart);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.ready = true;
    this.setTheme('light');
    this.reframe();
  }

  // ------------------------------------------------------------------------------------------------------------
  // API

  override setScene(desc: ToolStringScene, background: string, fit = false): void {
    // El eje de la sarta pasa por el pivote: gira sobre sí misma y se acuesta alrededor de su centro.
    this.content.position.y = -(desc.focus.min[1] + desc.focus.max[1]) / 2;
    super.setScene(desc, background, fit);
    const env = this.objects.get('env')?.object ?? null;
    if (env !== this.envObject) {
      this.envObject = env;
      env?.traverse((o) => {
        for (const m of materialsOf(o)) {
          m.userData.baseOpacity ??= m.opacity;
          m.transparent = true;
          m.needsUpdate = true;
        }
      });
      this.applyEnv();
      this.schedulePrecompile();
    }
  }

  /** Luces según el tema: estudio en claro; pieza iluminada sobre fondo profundo en oscuro. */
  setTheme(theme: 'light' | 'dark'): void {
    const dark = theme === 'dark';
    this.key.intensity = dark ? 2.3 : 2.0;
    this.rim.intensity = dark ? 2.2 : 1.25;
    this.rim.color.set(dark ? 0xc9d6ff : 0xffffff);
    this.fill.intensity = dark ? 0.28 : 0.6;
    this.scene.environmentIntensity = dark ? 0.6 : 1;
    this.renderer.toneMappingExposure = dark ? 1.08 : 1.12;
    this.requestRender();
  }

  setSpinning(on: boolean): void {
    this.spinning = on && !this.reducedMotion() && !this.interacted;
    this.schedule();
  }

  /** Vuelve a encuadrar en la caja del CSS (cambió el diseño de la pantalla sin cambiar el tamaño del lienzo). */
  reframe(): void {
    if (!this.ready) return;
    this.applyOffset();
    if (!this.userMoved && !this.timeline) this.fitDistance();
    this.requestRender();
  }

  override resetView(): void {
    this.reframe();
  }

  /**
   * Entrada al pozo en `ms` milisegundos (sin animación con movimiento reducido o `ms` = 0). Resuelve al terminar, al
   * saltarla (`finish`) o si la pestaña se oculta. Llamarla de nuevo mientras corre devuelve la misma promesa.
   */
  enter(toolId: string | null, ms: number): Promise<void> {
    const d = this.desc;
    if (this.timeline) return this.pending!;
    if (!d || ms <= 0 || this.reducedMotion() || document.hidden) return Promise.resolve();
    const tool = (toolId ? d.tools.find((t) => t.toolId === toolId && !t.hostId) : undefined) ?? visibleTool(d);
    if (!tool) return Promise.resolve();
    this.spinning = false;
    this.controls.enabled = false;

    const q0 = this.pivot.quaternion.clone();
    const q1 = new Quaternion();
    const p0 = this.pivot.position.clone();
    // Con la sarta vertical y sin giro, la herramienta queda en el origen.
    const p1 = new Vector3(tool.center[0], (tool.y0 + tool.y1) / 2, tool.center[1]).add(this.content.position).negate();
    const s0 = this.spin.rotation.y;
    // El corte de la formación mira a la cámara final con el giro en una vuelta entera.
    const s1 = Math.round(s0 / (Math.PI * 2)) * Math.PI * 2;
    const t0 = this.controls.target.clone();
    const from = new Spherical().setFromVector3(this.camera.position.clone().sub(t0));
    // Dos tramos: (1) acercarse a la herramienta mientras la sarta se pone vertical; (2) retroceder un poco desde el
    // lado del corte mientras aparece la formación, hasta que se leen las capas alrededor del pozo.
    const aspect = this.size.w / this.size.h;
    const distFor = (size: number) => size / 2 / Math.tan(MathUtils.degToRad(FOV) / 2) / Math.min(1, aspect);
    const toolH = tool.y1 - tool.y0;
    const view = (size: number, elevationDeg: number, azimuth: number) => {
      const [sx, sz] = dir(azimuth);
      const el = MathUtils.degToRad(elevationDeg);
      return new Spherical().setFromVector3(new Vector3(sx * Math.cos(el), Math.sin(el), sz * Math.cos(el)).multiplyScalar(distFor(size)));
    };
    const env = d.environment;
    const near = view(Math.max(toolH * 1.5, env.rWall * 9), 6, VIEW_AZIMUTH);
    // Plano final: desde arriba y del lado del corte, con la tapa de la formación entera a lo ancho (se lee el cuarto
    // recortado alrededor del pozo) y el tramo de arriba de la sarta adentro.
    const FAR_EL = 24;
    const widthFit = (env.rOuter * 2 * 1.2) / Math.max(0.6, aspect);
    const far = view(Math.max(widthFit, toolH * 2), FAR_EL, VIEW_AZIMUTH + 0.1);
    // Objetivo final sobre el eje, un poco por debajo de la tapa. Con la sarta vertical, la herramienta queda en el
    // origen: un punto del eje a la altura `y` de la escena queda en `y − centro de la herramienta`.
    const farY = env.y1 - far.radius * Math.tan(MathUtils.degToRad(FOV) / 2) * 0.45;
    const tFar = new Vector3(-tool.center[0], farY - (tool.y0 + tool.y1) / 2, -tool.center[1]);
    // Azimut por el camino corto.
    const shortest = (a: number, b: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a));
    near.theta = shortest(from.theta, near.theta);
    far.theta = shortest(near.theta, far.theta);
    const lerpSph = (a: Spherical, b: Spherical, e: number) => sph.set(a.radius + (b.radius - a.radius) * e, a.phi + (b.phi - a.phi) * e, a.theta + (b.theta - a.theta) * e);
    const o0 = { ...this.offset };
    const sph = new Spherical();
    const v = new Vector3();
    const target = new Vector3();
    const ORIGIN = new Vector3();

    const apply = (k: number) => {
      const pose = easeInOut(span(k, 0, 0.6));
      this.pivot.quaternion.slerpQuaternions(q0, q1, pose);
      this.pivot.position.lerpVectors(p0, p1, pose);
      this.spin.rotation.y = s0 + (s1 - s0) * pose;
      if (k < 0.55) {
        const e = easeInOut(span(k, 0.03, 0.55));
        lerpSph(from, near, e);
        target.lerpVectors(t0, ORIGIN, e);
        this.offset = { x: o0.x * (1 - e), y: o0.y * (1 - e) };
      } else {
        const e = easeInOut(span(k, 0.55, 1));
        lerpSph(near, far, e);
        target.lerpVectors(ORIGIN, tFar, e);
        this.offset = { x: 0, y: 0 };
      }
      this.controls.target.copy(target);
      this.camera.position.copy(target).add(v.setFromSpherical(sph));
      this.camera.lookAt(target);
      this.applyOffset(false);
      this.envAmount = easeInOut(span(k, 0.45, 0.85));
      this.applyEnv();
    };
    this.pending = new Promise<void>((resolve) => {
      this.timeline = { start: performance.now(), ms, apply, resolve };
    });
    this.last = 0;
    this.schedule();
    return this.pending;
  }

  /**
   * Termina la entrada en el acto (saltar, Escape, pestaña oculta). Sin dibujar: en todos esos casos la escena se va o
   * no se ve, y un cuadro con la formación entera es el más caro.
   */
  finish(): void {
    const t = this.timeline;
    if (!t) return;
    t.apply(1);
    this.endTimeline();
  }

  /** Deja de animar y de escuchar la pestaña (antes de liberar; `dispose` lo hace igual). */
  stop(): void {
    clearTimeout(this.precompileTimer);
    cancelAnimationFrame(this.loop);
    this.loop = 0;
    this.spinning = false;
    this.endTimeline();
    this.controls.enabled = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    // Fuera de la vista ya, aunque la liberación venga después (no queda un lienzo viejo junto a uno nuevo).
    this.renderer.domElement.style.display = 'none';
  }

  /** El contexto ya se perdió: no hay nada caro que liberar después. */
  contextLost(): boolean {
    return this.renderer.getContext().isContextLost();
  }

  override dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.controls.removeEventListener('start', this.onStart);
    super.dispose();
  }

  // ------------------------------------------------------------------------------------------------------------
  // Internos

  protected override placeKeyLight(): void {
    // Luz lateral desde arriba a la izquierda y contraluz desde atrás a la derecha: separan la silueta del fondo.
    const r = 2000;
    this.key.target.position.set(0, 0, 0);
    this.key.position.set(-0.55 * r, 0.75 * r, 0.6 * r);
    this.rim.position.set(0.7 * r, 0.35 * r, -0.85 * r);
    this.key.target.updateMatrixWorld();
  }

  protected override resize(): void {
    super.resize();
    if (this.ready) this.reframe();
  }

  private readonly tick = () => {
    // `performance.now()` y no la marca del cuadro: la misma base de tiempo con la que empezó la línea de tiempo.
    const now = performance.now();
    this.loop = 0;
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
    this.last = now;
    const t = this.timeline;
    if (t) {
      const k = clamp01((now - t.start) / t.ms);
      t.apply(k);
      if (k >= 1) this.endTimeline();
    } else if (this.spinning) {
      this.spin.rotation.y += dt * SPIN_RAD_PER_S;
    }
    this.draw();
    this.schedule();
  };

  private schedule(): void {
    if (this.loop || this.disposed) return;
    if (document.hidden || (!this.spinning && !this.timeline)) {
      this.last = 0;
      return;
    }
    this.loop = requestAnimationFrame(this.tick);
  }

  private endTimeline(): void {
    const t = this.timeline;
    this.timeline = null;
    this.pending = null;
    t?.resolve();
  }

  private readonly onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.loop);
      this.loop = 0;
      // Sin cuadros no avanza: la entrada termina ya para que la interfaz siga.
      this.finish();
    } else this.schedule();
  };

  private readonly onStart = () => {
    if (this.timeline) return;
    this.interacted = true;
    this.spinning = false;
    this.callbacks.onInteract?.();
  };

  /** Corrimiento de la proyección para que el centro de la sarta caiga en el centro de la caja del CSS. */
  private applyOffset(measure = true): void {
    const { w, h } = this.size;
    if (measure) {
      const f = this.opts.frame();
      this.offset = { x: w / 2 - (f.x + f.w / 2), y: h / 2 - (f.y + f.h / 2) };
    }
    this.camera.setViewOffset(w, h, this.offset.x, this.offset.y, w, h);
  }

  /** Distancia de la cámara para que la sarta ocupe la caja (dos pasadas: la perspectiva es casi lineal en 1/d). */
  private fitDistance(): void {
    const d = this.desc;
    if (!d) return;
    const f = this.opts.frame();
    this.controls.target.set(0, 0, 0);
    const dirv = new Vector3(0, Math.sin(ELEVATION), Math.cos(ELEVATION));
    let dist = 1500;
    const a = new Vector3();
    const b = new Vector3();
    for (let i = 0; i < 2; i++) {
      this.camera.position.copy(dirv).multiplyScalar(dist);
      this.camera.lookAt(0, 0, 0);
      this.camera.updateMatrixWorld();
      this.scene.updateMatrixWorld();
      this.content.localToWorld(a.set(0, d.focus.max[1], 0)).project(this.camera);
      this.content.localToWorld(b.set(0, d.focus.min[1], 0)).project(this.camera);
      const spanX = (Math.abs(a.x - b.x) / 2) * this.size.w;
      const spanY = (Math.abs(a.y - b.y) / 2) * this.size.h;
      const k = Math.max(spanX / (f.w * 0.96), spanY / (f.h * 0.7), 1e-3);
      dist *= k;
    }
    this.camera.position.copy(dirv).multiplyScalar(dist);
    this.controls.minDistance = dist * 0.3;
    this.controls.maxDistance = dist * 1.6;
    this.controls.update();
  }

  private precompileTimer = 0;

  /**
   * La formación está oculta en reposo y three solo compila lo visible: sin esto, sus shaders y texturas se preparan en
   * el primer cuadro en que aparece, a mitad de la entrada (un tirón; con SwiftShader, segundos). Se hace apenas
   * después de armar la escena, fuera del primer cuadro de Inicio.
   */
  private schedulePrecompile(): void {
    clearTimeout(this.precompileTimer);
    this.precompileTimer = window.setTimeout(() => {
      const env = this.envObject;
      if (!env || this.disposed || env.visible) return;
      env.visible = true;
      try {
        env.traverse((o) => {
          for (const m of materialsOf(o)) {
            const map = (m as { map?: Texture | null }).map;
            if (map) this.renderer.initTexture(map);
          }
        });
        void this.renderer.compileAsync(env, this.camera, this.scene).catch(() => {});
      } finally {
        env.visible = this.envAmount > 0.001;
      }
    }, 400);
  }

  private applyEnv(): void {
    const env = this.envObject;
    if (!env) return;
    const a = this.envAmount;
    env.visible = a > 0.001;
    env.traverse((o) => {
      for (const m of materialsOf(o)) m.opacity = (m.userData.baseOpacity as number) * a;
    });
  }
}

const EXHIBIT_POSE = (() => {
  const q = new Quaternion();
  // Rz(π/2 − 0,07) acuesta la sarta con la cabeza (+y) a la izquierda, subiendo apenas; Ry(0,62) acerca la cabeza
  // (en perspectiva la cabeza se ve más grande que la cola: profundidad sin exagerar las medidas).
  const rz = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2 - 0.07);
  const ry = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.62);
  return q.multiplyQuaternions(ry, rz);
})();

function materialsOf(o: Object3D): Material[] {
  const m = (o as { material?: Material | Material[] }).material;
  return Array.isArray(m) ? m : m ? [m] : [];
}

/**
 * Herramienta para acercarse si no hay una elegida: la primera de arriba con cuerpo propio (las montadas en otra no
 * cuentan), cerca de la tapa de la formación, adonde sube el plano final.
 */
function visibleTool(d: ToolStringScene): ToolLayout | undefined {
  return d.tools.filter((t) => !t.hostId).sort((a, b) => b.y1 - a.y1)[0];
}
