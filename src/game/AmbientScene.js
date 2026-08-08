import * as THREE from 'three';
import { DungeonGenerator } from '../procedural/DungeonGen.js';
import { LEVEL_THEMES } from '../procedural/LayoutGen.js';

/**
 * Bóveda decorativa de fondo para el menú.
 *
 * El menú se veía sobre negro absoluto: un formulario flotando en la nada, sin
 * ninguna pista de qué clase de juego es esto. Aquí se construye una sala real —
 * el mismo generador que usa la partida— y se sobrevuela en órbita lenta, así que
 * lo primero que se ve al abrir el juego es el juego.
 *
 * No hay jugadores, ni fantasma, ni puzle: es escenografía. Se desmonta en cuanto
 * arranca una partida para no pagar su coste durante el juego.
 */

const ORBIT_RADIUS = 34;
const ORBIT_HEIGHT = 22;
const ORBIT_SPEED = 0.06; // rad/s — deliberadamente lento, no debe distraer

export class AmbientScene {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../engine/Renderer.js').EngineRenderer} renderer
   * @param {import('../engine/Lighting.js').EngineLighting} lighting
   * @param {import('../engine/Particles.js').ParticleField} particles
   */
  constructor({ scene, renderer, lighting, particles }) {
    this.scene = scene;
    this.renderer = renderer;
    this.lighting = lighting;
    this.particles = particles;

    this.dungeon = null;
    this.angle = 0;
    this.active = false;
    this.center = new THREE.Vector3(0, 0, 0);
  }

  /** Levanta la sala decorativa. Idempotente. */
  async start() {
    if (this.active) return;

    // Un tema al azar en cada arranque: el menú no siempre tiene el mismo color y
    // de paso se ve la variedad de biomas antes de jugar.
    const themeIndex = Math.floor(Math.random() * LEVEL_THEMES.length);
    const theme = LEVEL_THEMES[themeIndex];

    this.dungeon = new DungeonGenerator(this.scene);
    this.active = true;

    // Nivel alto = sala grande y con más muros; da una silueta más interesante.
    const info = await this.dungeon.generateLevel(themeIndex + 1, 4242, 0, 3);
    
    // Si el usuario inició partida rápido, stop() ya lo canceló
    if (!this.active) return;

    this.renderer.setAtmosphere({
      bg: theme.bg,
      color: theme.color,
      fogDensity: (theme.fogDensity || 0.035) * 0.7 // menos cerrada: se ve la sala entera
    });
    this.lighting.setupCornerLights(info.sizeX, info.sizeZ, theme.color);
    this.particles.setupAmbient(info.sizeX, info.sizeZ, theme.color);

    this.angle = Math.random() * Math.PI * 2;
  }

  /**
   * Órbita lenta alrededor del centro de la sala.
   *
   * Mientras `active`, esta escena es la **dueña** de la cámara: escribe su posición y
   * su orientación a pelo, sin pasar por `EngineCamera`. Por eso se llama después de
   * `step()` en el bucle y no antes —lo que escriba aquí tiene que ser lo último—, y
   * por eso `startLevel` empieza parándola. Si alguna vez las dos corrieran a la vez,
   * el síntoma sería una cámara que tiembla entre la órbita y el jugador.
   */
  update(delta, camera) {
    if (!this.active || !camera) return;

    this.angle += ORBIT_SPEED * delta;
    camera.position.set(
      Math.cos(this.angle) * ORBIT_RADIUS,
      ORBIT_HEIGHT,
      Math.sin(this.angle) * ORBIT_RADIUS
    );
    camera.lookAt(this.center);
  }

  stop() {
    if (!this.active) return;
    this.dungeon.clear();
    this.scene.remove(this.dungeon.group);
    this.dungeon = null;
    this.particles.clearAmbient();
    this.active = false;
  }
}
