import * as THREE from 'three';

/**
 * Paleta y fábricas de materiales.
 *
 * Los mismos seis hex estaban repetidos por ocho ficheros, y eso escondía un
 * detalle que costaba encontrar: hay **dos naranjas casi idénticos y sin relación
 * entre sí**. `PLATE_IDLE` (0xffa500) es el estado en reposo de una placa; `AMBER`
 * (0xffaa00) es el color de un bioma. Se parecen lo bastante como para que
 * cualquiera "corrigiese" uno por el otro pensando que era una errata.
 */
export const PALETTE = {
  // Colores de bioma. Deben coincidir con LEVEL_THEMES de LayoutGen.js.
  CYAN: 0x00f3ff,
  MAGENTA: 0xff0077,
  EMERALD: 0x00ff66,
  AMBER: 0xffaa00,
  PURPLE: 0x9d00ff,

  // Agentes, en orden de índice.
  PLAYER: [0x00f3ff, 0xff0077, 0x00ff66],

  // Estados de puzle.
  PLATE_IDLE: 0xffa500, // ojo: NO es AMBER, ver comentario de arriba
  PLATE_ACTIVE: 0x00ff66,
  DOOR_LOCKED: 0xff0055,
  DOOR_OPEN: 0x00ff66,

  // Amenaza.
  DANGER: 0xff0033,
  GHOST_AURA: 0xff0044,

  // Superficies oscuras.
  BODY_DARK: 0x111525,
  STRUCTURE_DARK: 0x151828,
  POLE_DARK: 0x1a1e30,
  PLATE_BASE: 0x222638
};

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
