/**
 * PRNG sembrado y determinista.
 *
 * Sustituye a los `Math.sin(seed + i * 31)` que se usaban como falso aleatorio:
 * aquellos producían secuencias correlacionadas, y por eso los muros salían
 * amontonados y solapados en vez de repartidos.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Envoltorio con las operaciones que necesitan los generadores. */
export function createRandom(seed) {
  const next = mulberry32(seed);

  return {
    next,
    /** Entero en [min, max] inclusive. */
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    float(min, max) {
      return min + next() * (max - min);
    },
    bool(probability = 0.5) {
      return next() < probability;
    },
    pick(list) {
      return list[Math.floor(next() * list.length)];
    },
    /** Fisher-Yates sobre una copia; no muta la lista original. */
    shuffle(list) {
      const out = list.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    }
  };
}

/** Combina nivel y variante en una semilla estable y bien distribuida. */
export function deriveSeed(baseSeed, levelNum, seedOffset = 0) {
  let h = (baseSeed >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (levelNum * 0x85ebca6b), 0xc2b2ae35);
  h = Math.imul(h ^ (seedOffset * 0x27d4eb2f), 0x165667b1);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Etiqueta corta y legible de la semilla, la que se muestra en el HUD. */
export function seedLabel(seed) {
  return `#${(seed % 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
}
