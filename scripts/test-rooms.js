/**
 * Pruebas del servidor de salas, sin navegador y sin la API de cuentas.
 *
 * El `test:e2e` cubre el juego de punta a punta, pero necesita Chrome y una
 * instancia de realtyba-api en marcha, así que no sirve para comprobar
 * rápidamente la lógica de salas. Estas comprobaciones corren en un segundo con
 * `node` pelado y cubren justo los fallos que se arreglaron:
 *
 *   - el nivel avanzaba de tres en tres (y escribía tres veces en Laravel),
 *   - entrar en una sala llena te echaba de la tuya,
 *   - `intentionalLeaves` crecía sin límite,
 *   - la posición del cliente se guardaba sin validar,
 *   - dos pestañas de la misma cuenta se expulsaban entre ellas.
 *
 * Uso: node scripts/test-rooms.js
 */
import { RoomManager } from '../server/rooms/RoomManager.js';
import { sanitizeVec3, DISCONNECT_GRACE_MS } from '../server/rooms/roomState.js';

let passed = 0;
let failed = 0;

function check(condition, ok, ko) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${ok}`);
  } else {
    failed++;
    console.error(`  ✗ ${ko}`);
  }
}

function section(title) {
  console.log(`\n▸ ${title}`);
}

/** Sala con `count` agentes ya dentro. */
function makeRoom(manager, count = 3) {
  const { room } = manager.createRoom({ uid: 'u1', name: 'A', socketId: 's1' });
  for (let i = 2; i <= count; i++) {
    manager.joinRoom({ code: room.code, uid: `u${i}`, name: `P${i}`, socketId: `s${i}` });
  }
  return room;
}

// ---------------------------------------------------------------- avance de nivel

section('avance de nivel');
{
  const manager = new RoomManager();
  const room = makeRoom(manager, 3);
  manager.startGame(room);

  const startLevel = room.currentLevel;

  /**
   * Reproduce la guarda del manejador: cada agente que cruza la salida emite su
   * propio aviso, y los tres llegan en turnos distintos del bucle de eventos.
   */
  const completions = [];
  const handleComplete = announced => {
    if (room.completingLevel) return;
    if (Number.isFinite(announced) && announced !== room.currentLevel) return;

    room.completingLevel = true;
    try {
      completions.push(room.currentLevel);
      manager.advanceLevel(room);
    } finally {
      room.completingLevel = false;
    }
  };

  // Los tres anuncian el MISMO nivel, que es lo que ocurre de verdad.
  handleComplete(startLevel);
  handleComplete(startLevel);
  handleComplete(startLevel);

  check(
    room.currentLevel === startLevel + 1,
    `tres avisos del mismo nivel suben exactamente uno (${startLevel} -> ${room.currentLevel})`,
    `el nivel avanzó de más: ${startLevel} -> ${room.currentLevel}`
  );
  check(
    completions.length === 1,
    'solo se reporta el progreso una vez',
    `se reportó el progreso ${completions.length} veces`
  );

  // Un aviso rezagado del nivel anterior no debe hacer nada.
  const afterLevel = room.currentLevel;
  handleComplete(startLevel);
  check(
    room.currentLevel === afterLevel,
    'un aviso rezagado del nivel anterior se descarta',
    `un aviso rezagado avanzó el nivel a ${room.currentLevel}`
  );

  check(
    room.players.every(p => p.health === 100 && p.alive),
    'al avanzar de nivel todos vuelven con vida completa',
    'algún agente no se reinició al avanzar de nivel'
  );
}

// ------------------------------------------------------------------ entrar/salir

section('altas y bajas');
{
  const manager = new RoomManager();

  // Sala llena.
  const full = makeRoom(manager, 3);
  // Sala propia del intruso.
  const { room: own } = manager.createRoom({ uid: 'u9', name: 'Z', socketId: 's9' });

  const result = manager.joinRoom({ code: full.code, uid: 'u9', name: 'Z', socketId: 's9' });

  check(!!result.error, 'entrar en una sala llena falla', 'se pudo entrar en una sala llena');
  check(
    manager.getRoom(own.code) !== null,
    'al fallar el alta, la sala propia sigue existiendo',
    'al fallar el alta se borró la sala propia'
  );
  check(
    manager.findRoomByUid('u9') === manager.getRoom(own.code),
    'el agente sigue en su sala tras el intento fallido',
    'el agente fue expulsado de su sala por un intento fallido'
  );
}

{
  const manager = new RoomManager();
  const a = makeRoom(manager, 1);
  const { room: b } = manager.createRoom({ uid: 'u2', name: 'B', socketId: 's2' });

  manager.joinRoom({ code: b.code, uid: 'u1', name: 'A', socketId: 's1' });

  check(
    manager.getRoom(a.code) === null,
    'cambiar de sala borra la anterior si se queda vacía',
    'la sala anterior quedó huérfana al cambiar de sala'
  );
  check(
    manager.findRoomByUid('u1').code === b.code,
    'el índice uid -> sala apunta a la sala nueva',
    'el índice uid -> sala quedó desactualizado'
  );
}

// -------------------------------------------------------------------- memoria

section('memoria');
{
  const manager = new RoomManager();

  // 50 ciclos de sala creada y abandonada.
  for (let i = 0; i < 50; i++) {
    const { room } = manager.createRoom({ uid: `x${i}`, name: 'X', socketId: `sx${i}` });
    manager.joinRoom({ code: room.code, uid: `y${i}`, name: 'Y', socketId: `sy${i}` });
    manager.leaveRoom(`x${i}`);
    manager.leaveRoom(`y${i}`);
  }

  check(manager.rooms.size === 0, 'no queda ninguna sala tras 50 ciclos', `quedan ${manager.rooms.size} salas`);
  check(
    manager.uidToRoom.size === 0,
    'el índice uid -> sala queda vacío',
    `el índice retiene ${manager.uidToRoom.size} entradas`
  );

  check(
    manager.intentionalLeaves.size === 100,
    'las salidas voluntarias se registran mientras son recientes',
    `se registraron ${manager.intentionalLeaves.size} salidas voluntarias`
  );

  // El barrido, con el reloj adelantado, tiene que soltarlas todas.
  manager.sweepStaleRooms(Date.now() + 10 * 60 * 1000);
  check(
    manager.intentionalLeaves.size === 0,
    'el barrido purga las salidas voluntarias caducadas',
    `tras el barrido quedan ${manager.intentionalLeaves.size} salidas voluntarias`
  );
}

{
  // Salas abandonadas sin que ningún temporizador lo registrase.
  const manager = new RoomManager();
  const room = makeRoom(manager, 2);
  room.players.forEach(p => {
    p.connected = false;
    p.disconnectedAt = Date.now() - DISCONNECT_GRACE_MS * 5;
  });

  const swept = manager.sweepStaleRooms();
  check(swept === 1 && manager.rooms.size === 0, 'el barrido retira las salas zombi', 'la sala zombi sobrevivió al barrido');
}

// ---------------------------------------------------------------- saneamiento

section('validación de posiciones');
{
  check(sanitizeVec3({ x: 1, y: 2, z: 3 }) !== null, 'una posición normal se acepta', 'se rechazó una posición válida');
  check(sanitizeVec3({ x: NaN, y: 0, z: 0 }) === null, 'NaN se rechaza', 'se aceptó un NaN');
  check(sanitizeVec3({ x: 1e9, y: 0, z: 0 }) === null, 'una coordenada desorbitada se rechaza', 'se aceptó una coordenada desorbitada');
  check(sanitizeVec3(null) === null, 'null se rechaza', 'se aceptó null');
  check(sanitizeVec3('nope') === null, 'una cadena se rechaza', 'se aceptó una cadena');

  const padded = sanitizeVec3({ x: 1, y: 2, z: 3, relleno: 'A'.repeat(10000) });
  check(
    padded !== null && Object.keys(padded).length === 3,
    'la carga extra se descarta: solo se guardan x, y, z',
    'la carga extra sobrevivió al saneamiento'
  );

  const manager = new RoomManager();
  const room = makeRoom(manager, 1);
  const original = { x: 5, y: 0, z: 5 };
  manager.updatePlayerTransform(room, 'u1', original, 0.5);
  original.x = 999; // mutar el objeto del cliente no debe afectar al servidor

  check(
    manager.findPlayer(room, 'u1').position.x === 5,
    'la posición se copia, no se guarda por referencia',
    'el servidor guardó la referencia del objeto del cliente'
  );
}

// ------------------------------------------------------------------ multipestaña

section('dos pestañas de la misma cuenta');
{
  const manager = new RoomManager();
  const room = makeRoom(manager, 1);

  // La segunda pestaña se adueña del jugador.
  manager.attachSocket(room, 'u1', 's1-bis');

  // Se cierra la PRIMERA: su socket ya no es el del jugador.
  const affected = manager.markDisconnected('u1', () => {}, 's1');

  check(affected === null, 'cerrar una pestaña vieja no marca al jugador como caído', 'una pestaña vieja marcó al jugador como caído');
  check(
    manager.findPlayer(room, 'u1').connected === true,
    'el jugador sigue conectado por la pestaña activa',
    'el jugador quedó desconectado teniendo una pestaña activa'
  );
  check(
    !manager.disconnectTimers.has('u1'),
    'no se arma ninguna expulsión pendiente',
    'se armó una expulsión para un jugador que sigue jugando'
  );

  // Cerrar la pestaña que sí manda sí debe contar.
  manager.markDisconnected('u1', () => {}, 's1-bis');
  check(
    manager.findPlayer(room, 'u1').connected === false,
    'cerrar la pestaña activa sí marca al jugador como caído',
    'cerrar la pestaña activa no marcó al jugador'
  );
  manager.cancelRemoval('u1');
}

console.log('');
console.log(failed === 0 ? `✓ ${passed} comprobaciones correctas.` : `✗ ${failed} de ${passed + failed} fallaron.`);
process.exit(failed === 0 ? 0 : 1);
