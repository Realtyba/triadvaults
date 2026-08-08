import * as THREE from 'three';

/**
 * Fábricas de materiales.
 *
 * La paleta se mudó a `palette.js` —que no importa Three— para que `LayoutGen` pueda
 * consumirla desde Node. Se reexporta aquí porque es de donde la importan los otros ocho
 * ficheros y no hay razón para hacerles cambiar el import.
 */
import { PALETTE } from './palette.js';
export { PALETTE };

/**
 * Material emisivo de neón.
 *
 * La intensidad se deja contenida y se pasa por el mapeo de tonos a propósito:
 * con valores altos el color satura al primario puro y la superficie se lee como
 * una pegatina plana en vez de como luz. Quien recoge el brillo es el bloom.
 */
export function neonMaterial(colorHex, { intensity = 0.8, roughness = 0.3, opacity = 1, metalness } = {}) {
  const params = {
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: intensity,
    roughness
  };
  if (metalness !== undefined) params.metalness = metalness;
  if (opacity < 1) {
    params.transparent = true;
    params.opacity = opacity;
  }
  return new THREE.MeshStandardMaterial(params);
}

/** Metal oscuro: cuerpos, postes y marcos. Es el contraste que hace legible el neón. */
export function darkBodyMaterial(colorHex = PALETTE.POLE_DARK, { metalness = 0.8, roughness = 0.4 } = {}) {
  return new THREE.MeshStandardMaterial({ color: colorHex, metalness, roughness });
}

/**
 * Ajusta un material que viene de un `.glb` para que se integre en la iluminación de la
 * bóveda.
 *
 * ## Por qué hace falta un sitio único
 *
 * Los materiales de la bóveda están calibrados a mano y **cada uno en su fichero**: el
 * suelo pide `envMapIntensity` 1,6 (`DungeonGen`), los muros 0,55 (`wallMaterial`), los
 * cuerpos oscuros 0,8. Un material de glTF llega con el valor por defecto de 1, o sea
 * el doble que un muro, así que un modelo importado brilla de más contra todo lo que
 * tiene alrededor sin que nadie haya decidido que brille.
 *
 * Con el entorno de `RoomEnvironment`, que tiene mucha más estructura que el lienzo
 * pintado, la diferencia deja de ser sutil. Y como esto lo van a usar los agentes, el
 * fantasma y los props, la decisión tiene que estar en un sitio: si cada uno ajusta lo
 * suyo, dentro de tres cambios ya no coinciden.
 *
 * ## El suelo de rugosidad
 *
 * Los packs CC0 vienen alrededor de `roughness` 0,5, que es un valor de estudio. Visto
 * en picado y con el neón rasante de este juego, eso se lee como plástico brillante. El
 * suelo sube la rugosidad **sin bajarla nunca**: un material que ya venía mate se queda
 * como estaba, porque ahí el autor sí decidió algo.
 *
 * @param {THREE.Material} material se modifica en el sitio
 */
export function prepareImportedMaterial(material, { envMapIntensity = 0.7, roughnessFloor = 0.55 } = {}) {
  if (!material) return material;

  if (material.envMapIntensity !== undefined) material.envMapIntensity = envMapIntensity;
  if (typeof material.roughness === 'number') {
    material.roughness = Math.max(material.roughness, roughnessFloor);
  }
  return material;
}
