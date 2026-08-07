import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { quality } from './QualitySettings.js';
import { clamp01 } from '../utils/math.js';

/**
 * Acabado de imagen: viñeta, aberración cromática, grano y un tinte de escena.
 *
 * Van juntos en un solo pase a propósito. Cada `ShaderPass` cuesta un render a
 * textura completo, y estos tres efectos son operaciones por píxel triviales: no
 * merece la pena pagar tres pasadas para hacer lo que cabe en una.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 1.0 },
    uAberration: { value: 1.0 },
    uGrain: { value: 1.0 },
    uTint: { value: new THREE.Color(0x00f3ff) },
    uTintAmount: { value: 0.06 },
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(0xff0033) }
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uAberration;
    uniform float uGrain;
    uniform vec3  uTint;
    uniform float uTintAmount;
    uniform float uTime;
    uniform float uFlash;
    uniform vec3  uFlashColor;
    varying vec2 vUv;

    // Ruido barato y estable por píxel; suficiente para grano de película.
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 centered = vUv - 0.5;
      float dist = length(centered);

      // La aberración crece hacia los bordes: en el centro la imagen queda limpia.
      float shift = uAberration * 0.0022 * dist;
      vec4 color;
      color.r = texture2D(tDiffuse, vUv + centered * shift).r;
      color.g = texture2D(tDiffuse, vUv).g;
      color.b = texture2D(tDiffuse, vUv - centered * shift).b;
      color.a = 1.0;

      color.rgb = mix(color.rgb, color.rgb * uTint, uTintAmount);

      float vignette = smoothstep(0.85, 0.28, dist);
      color.rgb *= mix(1.0, vignette, uVignette);

      // El grano se atenúa en las sombras. Aplicado plano, las zonas negras —que
      // en esta escena son casi toda la pantalla— se llenaban de puntos blancos
      // y parecían ruido de vídeo, no textura de película.
      float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      float grainMask = smoothstep(0.0, 0.35, luma);
      float grain = (hash(vUv * 800.0 + uTime) - 0.5) * 0.03 * uGrain * grainMask;
      color.rgb += grain;

      // Destello de pantalla al recibir daño; lo dispara el bucle de juego.
      color.rgb = mix(color.rgb, uFlashColor, uFlash * 0.45);

      gl_FragColor = color;
    }
  `
};

export class PostFX {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   */
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = null;
    this.gradePass = null;
    this.bloomPass = null;
    this.elapsed = 0;
    this.flash = 0;

    this.build();
    this.unsubscribe = quality.subscribe(() => this.build());
  }

  get enabled() {
    return !!this.composer;
  }

  /** (Re)construye la cadena según el preset activo. */
  build() {
    this.dispose();
    if (!quality.get('postprocessing')) return;

    const size = this.renderer.getSize(new THREE.Vector2());
    const composer = new EffectComposer(this.renderer);
    composer.setSize(size.x, size.y);
    composer.setPixelRatio(this.renderer.getPixelRatio());

    composer.addPass(new RenderPass(this.scene, this.camera));

    // El neón de placas, molduras y cabezas es material emisivo: el bloom es lo
    // que lo convierte en luz en vez de en color plano.
    // El umbral viaja en el preset, no fijo en el código.
    //
    // Estaba clavado en 0.62 mientras la intensidad subía hasta 0.95 y las luces de
    // esquina pasaban de 4 a 6. La rejilla del suelo es un `emissiveMap`, así que
    // con esa combinación cruzaba el umbral y dejaba de leerse como textura: se
    // fundía en un resplandor uniforme. Es exactamente el "se ve raro en ultra".
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      quality.get('bloomStrength'),
      0.5, // radio
      quality.get('bloomThreshold')
    );
    composer.addPass(this.bloomPass);

    this.gradePass = new ShaderPass(GradeShader);
    composer.addPass(this.gradePass);

    // Convierte el espacio lineal al del display. Todo lo que juzgue la imagen por
    // su luminosidad tiene que ir DESPUÉS.
    composer.addPass(new OutputPass());

    // SMAA detecta bordes por luminancia, así que necesita la imagen ya convertida
    // al espacio del display. Colocado antes de `OutputPass` —como estaba— trabajaba
    // sobre datos lineales en coma flotante y sus umbrales quedaban descalibrados
    // justo en los bordes de neón, que son los que se miran.
    if (quality.get('smaa')) {
      composer.addPass(new SMAAPass(size.x, size.y));
    }

    this.composer = composer;
  }

  /** Tiñe el acabado con el color del tema del nivel. */
  setThemeColor(colorHex) {
    if (!this.gradePass) return;
    this.gradePass.uniforms.uTint.value.setHex(colorHex);
  }

  /**
   * Cierra la imagen según lo cerca que esté la amenaza.
   *
   * `uVignette` y `uAberration` ya existían en el shader y se fijaban una vez para
   * no volver a tocarse nunca. Animarlos es, con diferencia, lo que más miedo da por
   * lo poco que cuesta: la viñeta estrecha el campo visual —el efecto de túnel de
   * cuando algo te va a alcanzar— y la aberración descompone los bordes.
   *
   * @param {number} amount de 0 (lejos) a 1 (encima)
   */
  setDread(amount = 0) {
    if (!this.gradePass) return;

    const dread = quality.get('dreadPostFX') ? clamp01(amount) : 0;
    this.gradePass.uniforms.uVignette.value = 0.6 + dread * 1.0;
    this.gradePass.uniforms.uAberration.value = 1.0 + dread * 3.0;
  }

  /** Destello de pantalla; decae solo. `intensity` de 0 a 1. */
  triggerFlash(intensity = 1, colorHex = 0xff0033) {
    this.flash = clamp01(this.flash + intensity);
    if (this.gradePass) this.gradePass.uniforms.uFlashColor.value.setHex(colorHex);
  }

  setSize(width, height) {
    if (!this.composer) return;
    // `setSize` ya propaga el tamaño a cada pase, incluido el bloom, y en píxeles
    // de dispositivo. Reescribir después `bloomPass.resolution` con píxeles CSS lo
    // desincronizaba del tamaño real de sus render targets, y por el doble justo
    // en los presets con más ratio de píxel.
    this.composer.setSize(width, height);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
  }

  /**
   * @returns {boolean} true si ha pintado; false para que el llamante haga el
   *   render directo (preset sin postprocesado).
   */
  render(delta = 0) {
    if (!this.composer) return false;

    this.elapsed += delta;
    this.flash = Math.max(0, this.flash - delta * 3.5);

    if (this.gradePass) {
      this.gradePass.uniforms.uTime.value = this.elapsed;
      this.gradePass.uniforms.uFlash.value = this.flash;
    }

    this.composer.render(delta);
    return true;
  }

  dispose() {
    if (this.composer) {
      this.composer.passes.forEach(pass => pass.dispose && pass.dispose());
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();

      // `copyPass` no está en `passes`: lo crea el propio EffectComposer para sus
      // volcados internos. Como `build()` se rehace en cada cambio de calidad, sin
      // esto cada vuelta por el selector de opciones dejaba atrás un material de
      // pantalla completa.
      if (this.composer.copyPass && this.composer.copyPass.dispose) {
        this.composer.copyPass.dispose();
      }
    }
    this.composer = null;
    this.gradePass = null;
    this.bloomPass = null;
  }

  destroy() {
    this.dispose();
    if (this.unsubscribe) this.unsubscribe();
  }
}
