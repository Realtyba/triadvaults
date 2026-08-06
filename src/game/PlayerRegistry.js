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

  /** Instantánea que consumen la IA del fantasma y el puzle. */
  snapshot(isOnPlate) {
    return this.list().map(entity => ({
      uid: entity.uid,
      index: entity.index,
      position: entity.getPosition(),
      health: entity.health,
      alive: entity.alive,
      onPlate: isOnPlate ? isOnPlate(entity.getPosition()) : false
    }));
  }
}
