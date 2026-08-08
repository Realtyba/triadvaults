import * as THREE from 'three';
import { PALETTE } from './materials.js';

/**
 * Material del fantasma: borde de fresnel y disolución por ruido.
 *
 * ## Por qué no es un `ShaderMaterial`
 *
 * Sería lo natural para un efecto tan propio, y es la trampa. Un `ShaderMaterial` en
 * crudo empieza sin **`skinning`**, sin niebla, sin `envMap`, sin sombras y sin mapeo de
 * tonos: habría que reimplementar a mano justo lo que se acaba de ganar poniéndole al
 * fantasma un modelo con esqueleto, y el resultado quedaría además fuera de la
 * iluminación del resto de la sala.
 *
 * Así que se hace como los muros: un `MeshStandardMaterial` normal con GLSL inyectado en
 * `onBeforeCompile` (ver `wallMaterial.js`, que es el precedente). Lo que se escribe es
 * la diferencia, y todo lo demás sigue funcionando.
 *
 * **Nada se comparte con el material de los muros**, por muy parecido que sea el molde:
 * aquél lee `instanceMatrix` en el vértice, que solo existe en un `InstancedMesh`, y aquí
 * ni siquiera compilaría.
 *
 * ## Qué hace cada mitad
 *
 * El **fresnel** enciende el contorno según lo rasante que sea la mirada: es lo que
 * despega una silueta casi negra de un suelo casi negro. Es el mismo trabajo que hacía
 * el contorno por casco invertido, pero siguiendo la forma real del modelo en vez de una
 * copia hinchada, así que no se pierde con la pose.
 *
 * La **disolución** perfora el cuerpo con ruido que sube por el eje vertical. Sustituye a
 * los seis conos de tela que colgaban del núcleo: hacía falta que la silueta no fuese
 * sólida —una silueta sólida el ojo la fija y deja de darle miedo— y esos conos costaban
 * seis llamadas de dibujo. Ahora no cuesta ninguna.
 *
 * `uCharge` es lo que ata las dos cosas al comportamiento: sube al cargar la embestida y
 * hace que el borde se encienda y la disolución se acelere. Es lo que permite **ver
 * venir** el ataque, que es la diferencia entre una muerte injusta y una que te has
 * ganado.
 *
 * ## Tres niveles
 *
 * `basic` no inyecta nada. Es para el preset `bajo`, que no tiene postprocesado: sin
 * bloom, un fresnel tenue no se recoge y solo suma coste, así que ahí la legibilidad
 * sigue siendo cosa del contorno por casco invertido que ya existía.
 */

const VERTEX_PARS = /* glsl */ `
varying vec3 vGhostPosition;
`;

const VERTEX_BODY = /* glsl */ `
  vGhostPosition = position;
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec3 vGhostPosition;
uniform vec3 uRimColor;
uniform float uTime;
uniform float uCharge;
uniform float uDissolve;

// Ruido de valor por hash. Barato y suficiente: lo que hay que romper es una silueta,
// no generar una textura que alguien vaya a mirar de cerca.
float ghostHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float ghostNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  return mix(
    mix(mix(ghostHash(i + vec3(0, 0, 0)), ghostHash(i + vec3(1, 0, 0)), f.x),
        mix(ghostHash(i + vec3(0, 1, 0)), ghostHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(ghostHash(i + vec3(0, 0, 1)), ghostHash(i + vec3(1, 0, 1)), f.x),
        mix(ghostHash(i + vec3(0, 1, 1)), ghostHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
`;

/**
 * La disolución va **antes** de que se use `diffuseColor`, en el hueco de `map_fragment`.
 *
 * El `discard` mira solo la parte baja del cuerpo: deshilachar por arriba le comería la
 * cabeza y con ella los ojos, que son la señal de a por quién va. Lo que se rompe es el
 * bajo de la figura, que es donde antes colgaban los jirones.
 */
const FRAGMENT_DISSOLVE = /* glsl */ `
  float ghostHeight = clamp(vGhostPosition.y * 0.5 + 0.5, 0.0, 1.0);
  float ghostFray = ghostNoise(vGhostPosition * 6.0 + vec3(0.0, uTime * -0.9, 0.0));
  // 1 abajo del todo, 0 de la cintura para arriba.
  float ghostSkirt = 1.0 - smoothstep(0.0, 0.45, ghostHeight);
  float ghostCut = uDissolve * ghostSkirt * (1.0 + uCharge * 0.6);
  if (ghostFray < ghostCut) discard;
`;

/**
 * El fresnel va **después de `normal_fragment_maps`**, que es donde `normal` ya existe y
 * todavía no la ha consumido la iluminación.
 *
 * Estuvo inyectado tras `metalnessmap_fragment` —copiando a `wallMaterial.js`, que sí
 * puede permitírselo porque no usa la normal— y ahí el shader **no compilaba**: en
 * `meshphysical_frag`, `normal_fragment_begin` viene un par de líneas *después*, así que
 * `normal` era un identificador sin declarar. El fallo no se veía como un fallo: Three.js
 * escupe el error por consola, se queda sin programa y el fantasma se dibujaba sin borde,
 * que es exactamente lo que se ve cuando el efecto está apagado a propósito. Llevaba así
 * en todos los presets menos `bajo`, que es el único que no llega a inyectar nada.
 *
 * `vViewPosition` la declara Three.js para cualquier material estándar, así que la
 * dirección de vista sale gratis.
 */
const FRAGMENT_RIM = /* glsl */ `
  vec3 ghostView = normalize(vViewPosition);
  float ghostFacing = 1.0 - abs(dot(normalize(normal), ghostView));
  float ghostRim = pow(clamp(ghostFacing, 0.0, 1.0), 2.5);
  totalEmissiveRadiance += uRimColor * ghostRim * (0.6 + uCharge * 2.2);
`;

/**
 * @param {'basic'|'rim'|'full'} tier  lo que dice el preset (`ghostShader`)
 * @param {{color?: number}} [options] color del borde; por defecto el rojo de amenaza
 * @returns {THREE.MeshStandardMaterial} con `userData.ghostUniforms` para animarlo
 */
export function createGhostMaterial(tier = 'rim', { color = PALETTE.GHOST_AURA } = {}) {
  const material = new THREE.MeshStandardMaterial({
    color: 0x0a0208,
    emissive: 0x330008,
    emissiveIntensity: 0.45,
    roughness: 0.95,
    metalness: 0,
    // Sin `transparent`: la disolución usa `discard`, que no necesita ordenar nada por
    // profundidad. Con transparencia, el cuerpo se ordenaría contra los ojos y contra el
    // contorno y aparecerían recortes según el ángulo.
    transparent: false
  });

  const uniforms = {
    uRimColor: { value: new THREE.Color(color) },
    uTime: { value: 0 },
    uCharge: { value: 0 },
    // Cuánto se deshilacha en reposo. La embestida lo sube desde `uCharge`.
    uDissolve: { value: tier === 'full' ? 0.42 : 0 }
  };

  // Se cuelgan del material para que la entidad los mueva sin conocer el shader.
  material.userData.ghostUniforms = uniforms;
  material.userData.ghostTier = tier;

  if (tier === 'basic') return material;

  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAGMENT_RIM}`);

    if (tier === 'full') {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>\n${FRAGMENT_DISSOLVE}`);
    }
  };

  // **El nivel tiene que ir en la clave.** Sin él, cambiar de preset a mitad de partida
  // le serviría a este material el programa ya compilado del nivel anterior: se pediría
  // `full` y se seguiría viendo `rim`, sin ningún error por ninguna parte. Es la misma
  // trampa que documenta `wallMaterial.js`, con una vuelta de tuerca.
  material.customProgramCacheKey = () => `triad-ghost-${tier}`;

  return material;
}

/**
 * Adelanta el reloj del material y fija la carga de la embestida.
 *
 * @param {THREE.Material} material
 * @param {number} elapsed  reloj acumulado de la entidad, no `Date.now()`
 * @param {number} charge   0 acechando, 1 embistiendo
 */
export function updateGhostMaterial(material, elapsed, charge = 0) {
  const uniforms = material && material.userData.ghostUniforms;
  if (!uniforms) return;

  uniforms.uTime.value = elapsed;
  uniforms.uCharge.value = charge;
}
