import * as THREE from 'three';
import { createWallNormalTexture, createWallRoughnessTexture } from './textures.js';

/**
 * Material de los muros, con los bordes dibujados en el propio sombreador.
 *
 * ## El problema
 *
 * Los muros son cajas metálicas (`metalness` alto) sobre un suelo casi negro, y desde
 * la cámara en picado lo que se ve de cada uno es su cara superior y un trozo de la
 * cara lateral. Las dos reciben prácticamente el mismo reflejo del entorno del bioma,
 * así que la arista entre ellas **no existía visualmente**: el muro se leía como un
 * recorte de papel claro pegado sobre el suelo, sin volumen y sin saber dónde termina
 * uno y empieza el siguiente cuando dos se tocan en ángulo.
 *
 * Subir el contraste del material no lo arregla: el problema no es el brillo, es que
 * no hay ninguna discontinuidad marcada donde cambia la orientación de la superficie.
 *
 * ## Por qué en el sombreador y no con geometría
 *
 * Lo evidente sería un `LineSegments` con las aristas (`EdgesGeometry`), pero las
 * líneas de un píxel no reciben luz ni niebla, no se difuminan con la distancia y
 * `linewidth` se ignora en casi todas las plataformas: es exactamente el aspecto de
 * herramienta de depuración superpuesta que ya se rechazó para la rejilla del suelo
 * (ver `DungeonGen.buildFloor`). Y biselar las cajas de verdad rompe el
 * `InstancedMesh`, que es lo que paga el bloom en el preset móvil.
 *
 * Aquí el borde es **parte del material**: se oscurece y se ilumina en función de la
 * distancia al perímetro de cada cara, así que recibe la iluminación y la niebla del
 * nivel como cualquier otro píxel, y sigue siendo una única llamada de dibujo para
 * todos los muros de la sala.
 *
 * ## Por qué la anchura va en unidades de mundo y no en píxeles
 *
 * La caja es un cubo unidad escalado por la matriz de instancia, así que las UV de una
 * cara de 8×4 y las de una de 0,8×4 recorren el mismo 0..1: un borde medido en UV
 * saldría diez veces más grueso en el muro estrecho. Del vértice baja `vWallSize`, las
 * dos dimensiones **reales** de la cara, y con ellas la distancia al borde se calcula
 * en unidades de mundo. Así todos los muros tienen el mismo filo mida lo que mida el
 * muro, que es justo lo que hace que se lean como piezas del mismo material.
 */

/** Contorno oscuro pegado a la arista, en unidades de mundo (el muro mide 4 de alto). */
const EDGE_WIDTH = 0.05;

/** Filo iluminado que va justo por dentro del contorno. */
const GLOW_WIDTH = 0.07;

/**
 * Cuánto del color del bioma lleva el filo.
 *
 * Va contenido y **no** a color puro por el mismo motivo que `neonMaterial`: es el
 * bloom quien tiene que convertirlo en luz. A tope, las aristas saturan y el muro
 * vuelve a leerse como una pegatina, que es el problema del que se venía.
 */
const GLOW_INTENSITY = 0.4;

/** Color del contorno. No es negro puro: en la niebla del bioma cantaría como un agujero. */
const EDGE_COLOR = 0x05070e;

const VERTEX_PARS = /* glsl */ `
varying vec2 vWallUv;
varying vec2 vWallSize;
`;

/**
 * `instanceMatrix` la declara el propio Three.js en la cabecera del vértice cuando el
 * objeto es un `InstancedMesh`, así que aquí solo hay que leerla. La escala de cada
 * instancia es el módulo de sus tres primeras columnas.
 *
 * El reparto de ejes por cara es el de `BoxGeometry`: en las caras ±X la U recorre Z y
 * la V recorre Y; en las ±Y la U recorre X y la V recorre Z; en las ±Z, X e Y.
 */
const VERTEX_BODY = /* glsl */ `
  vWallUv = uv;

  vec3 wallScale = vec3(
    length(instanceMatrix[0].xyz),
    length(instanceMatrix[1].xyz),
    length(instanceMatrix[2].xyz)
  );

  vec3 faceAxis = abs(normal);
  vWallSize = faceAxis.x > 0.5
    ? vec2(wallScale.z, wallScale.y)
    : (faceAxis.y > 0.5 ? vec2(wallScale.x, wallScale.z) : vec2(wallScale.x, wallScale.y));
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec2 vWallUv;
varying vec2 vWallSize;
uniform vec3 uEdgeColor;
uniform vec3 uGlowColor;
uniform float uEdgeWidth;
uniform float uGlowWidth;
`;

/**
 * El suavizado sale de la derivada de las UV y **no** de `fwidth` sobre la distancia ya
 * calculada: ésta es un mínimo entre dos ejes, y en las diagonales que salen de cada
 * esquina —donde el mínimo cambia de eje— su derivada se dispara y aparece una cruz
 * tenue cruzando la cara.
 *
 * El contorno se deja además sin metalicidad: si reflejara el entorno como el resto del
 * muro, se borraría justo en las caras que están dando el brillo, que son las que más
 * necesitan el borde.
 */
const FRAGMENT_BODY = /* glsl */ `
  vec2 toEdge = min(vWallUv * vWallSize, (1.0 - vWallUv) * vWallSize);
  float edgeDistance = min(toEdge.x, toEdge.y);

  vec2 texel = fwidth(vWallUv) * vWallSize;
  float aa = max(max(texel.x, texel.y), 1e-4);

  float outline = 1.0 - smoothstep(uEdgeWidth - aa, uEdgeWidth + aa, edgeDistance);
  float rim = 1.0 - smoothstep(uEdgeWidth + uGlowWidth - aa, uEdgeWidth + uGlowWidth + aa, edgeDistance);
  rim = max(rim - outline, 0.0);

  diffuseColor.rgb = mix(diffuseColor.rgb, uEdgeColor, outline);
  metalnessFactor = mix(metalnessFactor, 0.0, outline);
  roughnessFactor = mix(roughnessFactor, 0.92, outline);
  totalEmissiveRadiance += uGlowColor * rim;
`;

/**
 * Material de muro para un bioma.
 *
 * @param {{wall: number, color: number}} theme bioma en curso (`LayoutGen.LEVEL_THEMES`)
 * @returns {THREE.MeshStandardMaterial}
 */
export function createWallMaterial(theme) {
  const material = new THREE.MeshStandardMaterial({
    color: theme.wall,
    roughness: 0.62,
    // Bajó de 0,65 y el entorno de 1,25 a 0,7 al llegar el borde dibujado. Con los
    // valores anteriores el reflejo del bioma saturaba la cara superior hasta casi el
    // blanco: el muro perdía su color propio, la moldura de neón embutida se disolvía
    // dentro de ese blanco y ningún filo podía destacar sobre él. El entorno sigue
    // estando —es lo que hace que el metal parezca metal—, pero ya no manda.
    metalness: 0.38,
    roughnessMap: createWallRoughnessTexture(),
    // El relieve sale del mismo ruido que la rugosidad, para que los brillos y los
    // bultos caigan en el mismo sitio. Ver `createWallNormalTexture`.
    normalMap: createWallNormalTexture(),
    normalScale: new THREE.Vector2(0.85, 0.85),
    envMapIntensity: 0.55
  });

  const uniforms = {
    uEdgeColor: { value: new THREE.Color(EDGE_COLOR) },
    uGlowColor: { value: new THREE.Color(theme.color).multiplyScalar(GLOW_INTENSITY) },
    uEdgeWidth: { value: EDGE_WIDTH },
    uGlowWidth: { value: GLOW_WIDTH }
  };

  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      // Después de `metalnessmap_fragment`: es el último punto en el que `diffuseColor`,
      // `roughnessFactor` y `metalnessFactor` existen y todavía no los ha consumido el
      // modelo de iluminación.
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${FRAGMENT_BODY}`);
  };

  // Sin esto, Three.js podría servirle a este material el programa ya compilado de un
  // `MeshStandardMaterial` corriente con los mismos ajustes, sin las aristas.
  material.customProgramCacheKey = () => 'triad-wall-edges';

  return material;
}
