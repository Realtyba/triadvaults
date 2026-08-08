import { PlayerEntity } from '../entities/Player.js';

/**
 * Entidades de jugador vivas en la escena, indexadas por `uid`.
 *
 * Indexar por uid (y no por `socket.id`) es lo que permite que una reconexión
 * conserve el personaje en vez de dejar un muñeco huérfano y quitarle el control
 * al jugador local.
 */
export class PlayerRegistry {
  constructor(scene) {
    this.scene = scene;
    this.players = new Map();
    this.localUid = null;

    /**
     * Búfer reutilizado de `snapshot()`.
     *
     * La instantánea se pide una vez por fotograma —y con varios fantasmas, sus
     * consumidores se multiplican—, así que rehacer el array y un objeto por
     * jugador cada vez era la fuente de basura más constante del bucle. Los
     * consumidores solo la leen dentro del fotograma, nunca la guardan.
     */
    this.snapshotBuffer = [];
  }

  get local() {
    return this.localUid ? this.players.get(this.localUid) || null : null;
  }

  get(uid) {
    return this.players.get(String(uid)) || null;
  }

  get size() {
    return this.players.size;
  }

  list() {
    return Array.from(this.players.values());
  }

  /** Itera las entidades sin crear un array intermedio. Para el bucle de juego. */
  forEachEntity(fn) {
    this.players.forEach(fn);
  }

  /**
   * Concilia la escena con la lista de jugadores del servidor: crea los nuevos,
   * elimina a los que se fueron y actualiza el resto sin recrear nada.
   */
  sync(roomPlayers = [], localUid, spawnResolver) {
    this.localUid = localUid ? String(localUid) : null;
    const seen = new Set();

    roomPlayers.forEach(p => {
      const uid = String(p.uid);
      seen.add(uid);

      let entity = this.players.get(uid);
      if (!entity) {
        entity = new PlayerEntity({
          uid,
          name: p.name,
          index: p.index,
          isLocal: uid === this.localUid
        });
        this.scene.add(entity.mesh);
        this.players.set(uid, entity);

        if (spawnResolver) {
          const spawn = spawnResolver(p.index);
          entity.setPosition(spawn.x, 0, spawn.z);
        }
      }

      entity.isLocal = uid === this.localUid;
      entity.name = p.name;
      entity.health = p.health ?? entity.health;
      entity.setAlive(p.alive !== false);
    });

    for (const uid of Array.from(this.players.keys())) {
      if (!seen.has(uid)) this.remove(uid);
    }
  }

  /** Modo en solitario sin sala: un único agente local. */
  createSolo(spawn) {
    this.clear();
    this.localUid = 'local';
    const entity = new PlayerEntity({ uid: 'local', name: 'SoloAgent', index: 0, isLocal: true });
    entity.setPosition(spawn.x, 0, spawn.z);
    this.scene.add(entity.mesh);
    this.players.set('local', entity);
    return entity;
  }

  remove(uid) {
    const entity = this.players.get(String(uid));
    if (!entity) return;
    entity.dispose(this.scene);
    this.players.delete(String(uid));
  }

  clear() {
    this.players.forEach(entity => entity.dispose(this.scene));
    this.players.clear();
    this.localUid = null;
  }

  /** Reubica a todos en celdas libres al arrancar o regenerar un nivel. */
  placeAll(spawnResolver) {
    this.players.forEach(entity => {
      const spawn = spawnResolver(entity.index);
      entity.setPosition(spawn.x, 0, spawn.z);
    });
  }

  updateRemotes(delta) {
    this.players.forEach(entity => {
      if (!entity.isLocal) entity.updateRemote(delta);
    });
  }

  /**
   * Instantánea que consumen la IA del fantasma y el puzle.
   *
   * Devuelve un búfer reutilizado: es válido hasta la siguiente llamada, así que
   * quien necesite conservarlo debe copiarlo. Ningún consumidor actual lo hace —
   * todos lo recorren y lo sueltan dentro del mismo fotograma.
   */
  snapshot(isOnPlate) {
    const buffer = this.snapshotBuffer;
    let i = 0;

    for (const entity of this.players.values()) {
      const position = entity.getPosition();
      const slot = buffer[i] || (buffer[i] = {});

      slot.uid = entity.uid;
      slot.index = entity.index;
      slot.position = position;
      slot.health = entity.health;
      slot.alive = entity.alive;
      slot.onPlate = isOnPlate ? isOnPlate(position) : false;
      i++;
    }

    // Al salir un jugador el búfer se queda largo: se recorta para que nadie
    // itere sobre entradas de una partida anterior.
    if (buffer.length > i) buffer.length = i;
    return buffer;
  }
}
