import * as THREE from 'three';
import { generateLayout, WALL_HEIGHT, WALL_THICKNESS } from './LayoutGen.js';
import { createGridTexture, createWallRoughnessTexture } from '../engine/textures.js';
import { disposeChildren, markShared } from '../engine/disposal.js';
import { neonMaterial } from '../engine/materials.js';

/**
 * Cubo unidad compartido por todos los muros y molduras.
 *
 * Antes cada muro creaba su propia `BoxGeometry`: unas 66 por sala, más otras
 * tantas al regenerar, cada una con su búfer en la GPU y su llamada de dibujo. Son
 * todas cajas: basta con una y escalar la malla. Es la mayor rebaja de llamadas de
 * dibujo del nivel, y se nota justo en las máquinas modestas.
 *
 * Va marcada como compartida para que la limpieza de nivel NO la libere: si
 * `disposeChildren` la soltase al descargar la primera sala, la segunda se
 * quedaría sin geometría. Se suelta en `disposeSharedGeometry`, al cerrar.
 */
const UNIT_BOX = markShared(new THREE.BoxGeometry(1, 1, 1));

export function disposeSharedGeometry() {
  UNIT_BOX.dispose();
}

/**
 * Construye la sala 3D a partir del trazado calculado por `LayoutGen`.
 * Aquí solo hay geometría: las decisiones de diseño (dónde va cada muro, si la
 * salida es alcanzable) ya vienen resueltas y validadas.
 */
export class DungeonGenerator {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.obstacleBoxes = [];
    this.layout = null;
  }

  clear() {
    disposeChildren(this.group);
    this.obstacleBoxes = [];
  }

  /**
   * @param {number} levelNum
   * @param {number} baseSeed   semilla de la sala (viene del servidor, igual para todos)
   * @param {number} seedOffset variante al regenerar
   * @param {number} plateCount placas requeridas, = número de agentes
   */
  generateLevel(levelNum = 1, baseSeed = 1, seedOffset = 0, plateCount = 1) {
    this.clear();

    const layout = generateLayout(levelNum, baseSeed, seedOffset, plateCount);
    this.layout = layout;

    const { theme, sizeX, sizeZ } = layout;
    this.buildFloor(sizeX, sizeZ, theme);

    const wallMat = new THREE.MeshStandardMaterial({
      color: theme.wall,
      roughness: 0.55,
      metalness: 0.65,
      roughnessMap: createWallRoughnessTexture()
    });

    // Emisivo, no `MeshBasicMaterial`: el bloom solo recoge lo que emite luz, y
    // con material básico las molduras eran color plano por muy brillante que fuese.
    //
    // La intensidad es contenida y se deja pasar por el mapeo de tonos: sin él, y
    // con valores altos, el color satura a cían puro y las molduras se ven como
    // pegatinas planas en vez de como luz.
    const trimMat = neonMaterial(theme.color, {
      intensity: 0.9,
      roughness: 0.35,
      metalness: 0.1
    });

    this.buildBoundary(sizeX, sizeZ, wallMat, trimMat);
    layout.walls.forEach(wall => this.buildWall(wall.x, wall.z, wall.width, wall.depth, wallMat, trimMat));

    return {
      seed: layout.seed,
      seedLabel: layout.seedLabel,
      theme,
      sizeX,
      sizeZ,
      navGrid: layout.grid,
      plates: layout.plates,
      spawnPos: new THREE.Vector3(layout.spawn.x, 0, layout.spawn.z),
      exitPositions: layout.exits.map(exit => new THREE.Vector3(exit.x, 0, exit.z)),
      // Alias de la primera salida, para lo que aún razona con una sola.
      exitPos: new THREE.Vector3(layout.exit.x, 0, layout.exit.z),
      obstacleBoxes: this.obstacleBoxes
    };
  }

  /**
   * Suelo del nivel.
   *
   * La rejilla se dibuja como textura sobre el propio suelo en vez de con un
   * `GridHelper`: aquél pinta líneas de 1px que no reciben luz ni sombra, y se
   * leía como una herramienta de depuración superpuesta a la escena.
   */
  buildFloor(sizeX, sizeZ, theme) {
    // La escala va en la petición, no se muta el objeto devuelto: la textura sale
    // de un caché compartido y escribir en ella afecta a todo el que la use.
    const gridTexture = createGridTexture(theme.color, 'default', { x: sizeX / 4, y: sizeZ / 4 });

    const floorGeo = new THREE.PlaneGeometry(sizeX, sizeZ);
    floorGeo.rotateX(-Math.PI / 2);

    const floor = new THREE.Mesh(
      floorGeo,
      new THREE.MeshStandardMaterial({
        color: theme.bg,
        roughness: 0.42,
        metalness: 0.72,
        map: gridTexture,
        emissive: theme.color,
        emissiveMap: gridTexture,
        emissiveIntensity: 0.35 // la rejilla brilla lo justo para que el bloom la roce
      })
    );
    floor.receiveShadow = true;
    this.group.add(floor);

    this.buildVoid(sizeX, sizeZ, theme);
  }

  /**
   * Plataforma exterior que se pierde en la niebla.
   *
   * Sin ella el suelo terminaba a plomo y todo lo que había más allá era negro
   * absoluto: media pantalla vacía y la sensación de estar sobre un recorte
   * flotando en la nada. Con una rejilla tenue que se disuelve, el mundo parece
   * continuar más allá de los muros.
   */
  buildVoid(sizeX, sizeZ, theme) {
    const span = Math.max(sizeX, sizeZ) * 4;

    // Repetición a la mitad de lo que había (`span / 8` daba hasta 18×18 sobre un
    // plano de 144 unidades). Vista en picado, esa densidad producía un moiré que
    // reptaba al mover la cámara y que se notaba más cuanto mayor era la resolución
    // de render, es decir justo en los presets altos.
    const tiling = span / 16;
    const voidTexture = createGridTexture(theme.color, 'void', { x: tiling, y: tiling });

    const geometry = new THREE.PlaneGeometry(span, span);
    geometry.rotateX(-Math.PI / 2);

    const plane = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: theme.bg,
        roughness: 0.9,
        metalness: 0.3,
        emissive: theme.color,
        emissiveMap: voidTexture,
        emissiveIntensity: 0.035, // apenas insinuada: es fondo, no escenario
        fog: true
      })
    );
    // Por debajo del suelo de la sala, para que no compitan por el mismo plano.
    plane.position.y = -0.6;
    this.group.add(plane);
  }

  buildBoundary(sizeX, sizeZ, wallMat, trimMat) {
    const halfX = sizeX / 2;
    const halfZ = sizeZ / 2;
    const t = WALL_THICKNESS;

    this.buildWall(0, -halfZ - t / 2, sizeX + t * 2, t, wallMat, trimMat);
    this.buildWall(0, halfZ + t / 2, sizeX + t * 2, t, wallMat, trimMat);
    this.buildWall(-halfX - t / 2, 0, t, sizeZ, wallMat, trimMat);
    this.buildWall(halfX + t / 2, 0, t, sizeZ, wallMat, trimMat);
  }

  /**
   * Un muro y su franja luminosa.
   *
   * La franja va **metida hacia dentro**, no desbordando el muro. Con la cámara
   * cenital lo que se ve de un muro es su cara superior, así que una moldura del
   * mismo tamaño la tapaba entera y todos los muros se leían como losas de neón
   * macizas. Dejando un borde oscuro alrededor, la franja se lee como una luz
   * empotrada y el muro recupera su volumen.
   */
  buildWall(x, z, width, depth, wallMat, trimMat) {
    const wall = new THREE.Mesh(UNIT_BOX, wallMat);
    wall.scale.set(width, WALL_HEIGHT, depth);
    wall.position.set(x, WALL_HEIGHT / 2, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.group.add(wall);

    const inset = 0.28;
    const trim = new THREE.Mesh(UNIT_BOX, trimMat);
    trim.scale.set(Math.max(0.12, width - inset), 0.12, Math.max(0.12, depth - inset));
    trim.position.set(x, WALL_HEIGHT + 0.02, z);
    this.group.add(trim);

    // `setFromObject` necesita la matriz al día, y estas mallas se acaban de crear
    // y escalar sin que haya pasado ningún render que la recalcule.
    wall.updateMatrixWorld(true);
    this.obstacleBoxes.push(new THREE.Box3().setFromObject(wall));
  }
}
