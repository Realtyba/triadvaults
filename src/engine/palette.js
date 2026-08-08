/**
 * La paleta del juego. **Sin Three.js**, y eso es el motivo de que viva aparte.
 *
 * Estaba dentro de `materials.js`, que importa Three. `LayoutGen.js` no puede importar
 * Three —lo carga `scripts/validate-levels.js` en Node pelado, sin navegador ni WebGL—,
 * así que sus cinco colores de bioma estaban copiados a mano con un comentario que decía
 * "deben coincidir con `PALETTE`". Un invariante mantenido a mano es un invariante que
 * antes o después no se mantiene.
 *
 * Partiéndola aquí, `LEVEL_THEMES` la importa de verdad y la coincidencia deja de ser una
 * promesa. `materials.js` la reexporta, así que sus ocho consumidores no cambian.
 *
 * Los mismos seis hex estaban además repetidos por ocho ficheros, y eso escondía un
 * detalle que costaba encontrar: hay **dos naranjas casi idénticos y sin relación entre
 * sí**. `PLATE_IDLE` (0xffa500) es el estado en reposo de una placa; `AMBER` (0xffaa00)
 * es el color de un bioma. Se parecen lo bastante como para que cualquiera "corrigiese"
 * uno por el otro pensando que era una errata.
 */
export const PALETTE = {
  // Colores de bioma. Los consume `LEVEL_THEMES` en `procedural/LayoutGen.js`.
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
