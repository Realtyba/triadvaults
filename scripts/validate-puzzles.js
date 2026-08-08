#!/usr/bin/env node
/**
 * Comprueba que cada arquetipo de puzle se puede resolver, y que no se puede
 * resolver de formas que romperían su propósito.
 *
 * `validate-levels.js` verifica el trazado —que los nodos caigan en celdas libres
 * y alcanzables—, pero no que la **regla** del puzle funcione. Un arquetipo cuya
 * condición de victoria nunca se cumpla dejaría al jugador encerrado en una sala
 * perfectamente jugable, que es el peor fallo posible: no hay error, no hay aviso,
 * simplemente no se puede salir.
 *
 * Se simulan agentes moviéndose sobre los nodos, sin navegador ni WebGL.
 *
 * Uso: node scripts/validate-puzzles.js
 */
import * as THREE from 'three';
import { generateLayout } from '../src/procedural/LayoutGen.js';
import { PUZZLE_TYPES } from '../src/procedural/puzzles/index.js';

const DT = 0.1;
const scene = new THREE.Scene();

/** Un agente situado exactamente sobre un nodo. */
const standingOn = node => ({ position: node.mesh.position, alive: true, health: 100 });
const away = () => ({ position: new THREE.Vector3(999, 0, 999), alive: true, health: 100 });

let failures = 0;

function check(condition, pass, fail) {
  if (condition) {
    console.log(`  ✓ ${pass}`);
  } else {
    console.error(`  ✗ ${fail}`);
    failures++;
  }
}

/** Monta un arquetipo sobre un trazado real. */
async function build(Type, playersCount, level = 20, seed = 7919) {
  const nodeCount = Type.nodeCount(playersCount);
  const layout = await generateLayout(level, seed, 0, nodeCount);
  const info = {
    ...layout,
    level,
    seedOffset: 0,
    plates: layout.plates,
    theme: layout.theme,
    exitPos: new THREE.Vector3(layout.exit.x, 0, layout.exit.z),
    exitPositions: layout.exits.map(exit => new THREE.Vector3(exit.x, 0, exit.z))
  };

  const puzzle = new Type(scene);
  await puzzle.generate(info, playersCount);
  return puzzle;
}

/** Recorre los nodos en el orden dado, soltando entre pisada y pisada. */
function stepThrough(puzzle, nodes) {
  let last = null;
  for (const node of nodes) {
    for (let i = 0; i < 3; i++) puzzle.update([away()], DT);
    last = puzzle.update([standingOn(node)], DT);
  }
  return last;
}

async function main() {
  console.log('Arquetipos de puzle\n');

  for (const Type of PUZZLE_TYPES) {
    const playersCount = Type.supports(1) ? 1 : 2;
    console.log(`▸ ${Type.key} (${playersCount} agente(s), ${Type.nodeCount(playersCount)} nodos)`);

    const puzzle = await build(Type, playersCount);

    // Camino feliz: cada arquetipo con la estrategia que espera de sus jugadores.
    let solved = false;
    if (Type.key === 'plates' || Type.key === 'timed') {
      for (let i = 0; i < 60 && !solved; i++) {
        solved = puzzle.update(puzzle.nodes.map(standingOn), DT).solved;
      }
    } else if (Type.key === 'sequence') {
      solved = stepThrough(puzzle, puzzle.nodes).solved;
    } else if (Type.key === 'relay') {
      for (const terminal of puzzle.terminals) {
        solved = puzzle.update([standingOn(puzzle.anchor), standingOn(terminal)], DT).solved;
      }
    }

    check(solved, 'se resuelve jugándolo como se espera', 'NO se resuelve: la sala sería una trampa');
    check(puzzle.isAtExit(puzzle.exitDoor.mesh.position), 'la salida se abre al resolverlo', 'la salida sigue cerrada tras resolverlo');
    console.log('');
  }

  // --------------------------------------------------------- comprobaciones negativas
  // Cada arquetipo existe por su restricción; si se puede saltar, no aporta nada
  // que no aportara ya el de placas.

  console.log('▸ restricciones propias de cada arquetipo');

  const Relay = PUZZLE_TYPES.find(t => t.key === 'relay');
  if (Relay) {
    const relay = await build(Relay, 2);
    relay.update([standingOn(relay.anchor), standingOn(relay.terminals[0])], DT);
    const released = relay.update(relay.terminals.map(standingOn), DT);
    check(
      !released.solved && released.progressPercent === 0,
      'el relevo se corta al soltar el ancla',
      'el relevo se resolvió sin sostener el ancla'
    );
  }

  const Sequence = PUZZLE_TYPES.find(t => t.key === 'sequence');
  if (Sequence) {
    const sequence = await build(Sequence, 1);
    // Se pisa el último primero: debe quedarse a cero, no avanzar.
    const outOfOrder = stepThrough(sequence, [sequence.nodes[sequence.nodes.length - 1]]);
    check(
      !outOfOrder.solved && outOfOrder.progressPercent === 0,
      'la secuencia no avanza si se pisa fuera de orden',
      'la secuencia avanzó con el orden equivocado'
    );

    // Y tras equivocarse debe poder completarse desde el principio.
    const recovered = stepThrough(sequence, sequence.nodes);
    check(recovered.solved, 'la secuencia se puede completar tras fallar', 'la secuencia quedó bloqueada tras un fallo');
  }

  const Timed = PUZZLE_TYPES.find(t => t.key === 'timed');
  if (Timed) {
    const timed = await build(Timed, 1);
    timed.update([standingOn(timed.nodes[0])], DT);
    // Se deja expirar la ventana sin tocar nada más.
    let expiredResult;
    for (let i = 0; i < Math.ceil(timed.window / DT) + 5; i++) {
      expiredResult = timed.update([away()], DT);
    }
    check(
      expiredResult.activeCount === 0,
      'los nodos temporizados expiran solos',
      'un nodo temporizado se quedó encendido para siempre'
    );
  }

  console.log('');

  if (failures === 0) {
    console.log('✓ Todos los arquetipos son jugables.');
  } else {
    console.error(`✗ ${failures} error(es) en los arquetipos.`);
    process.exit(1);
  }
}

main().catch(console.error);
