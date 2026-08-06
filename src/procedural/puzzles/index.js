import { createRandom, deriveSeed } from '../rng.js';
import { PressurePlates } from './PressurePlates.js';
import { SequenceLock } from './SequenceLock.js';
import { TimedGates } from './TimedGates.js';
import { RelayCircuit } from './RelayCircuit.js';

/**
 * Registro de arquetipos de puzle y su elección por nivel.
 *
 * **La elección tiene que ser determinista.** Cada cliente construye su propia
 * escena a partir de la semilla que manda el servidor; si dos agentes de la misma
 * sala eligieran arquetipos distintos, uno vería placas y el otro una secuencia, y
 * la partida sería injugable sin ningún error visible. Por eso aquí no se usa
 * `Math.random` en ningún sitio, solo el PRNG sembrado.
 */

export const PUZZLE_TYPES = [PressurePlates, SequenceLock, TimedGates, RelayCircuit];

const BY_KEY = new Map(PUZZLE_TYPES.map(type => [type.key, type]));

/** Los primeros niveles enseñan el juego: siempre el arquetipo más simple. */
const TUTORIAL_LEVELS = 3;

/** Desplazamiento para que la semilla del puzle no coincida con la del trazado. */
const PUZZLE_SEED_SALT = 0x5eed;

/**
 * Arquetipo que le toca a este nivel.
 *
 * @param {object} params
 * @param {number} params.level
 * @param {number} params.seed        semilla de la sala, dictada por el servidor
 * @param {number} [params.seedOffset] variante al regenerar
 * @param {number} params.playersCount
 * @returns {typeof PressurePlates} la clase, no una instancia
 */
export function selectPuzzleType({ level = 1, seed = 1, seedOffset = 0, playersCount = 1 }) {
  if (level <= TUTORIAL_LEVELS) return PressurePlates;

  const candidates = PUZZLE_TYPES.filter(type => type.supports(playersCount));
  if (candidates.length === 0) return PressurePlates;

  // La misma sala regenerada (`seedOffset`) puede cambiar de arquetipo: es parte
  // de lo que hace útil regenerar cuando un trazado se atraganta.
  const rng = createRandom(deriveSeed(seed ^ PUZZLE_SEED_SALT, level, seedOffset));
  return rng.pick(candidates);
}

/** Recupera un arquetipo por su clave; útil para pruebas y validación. */
export function puzzleTypeByKey(key) {
  return BY_KEY.get(key) || null;
}

export { PressurePlates, SequenceLock, TimedGates, RelayCircuit };
