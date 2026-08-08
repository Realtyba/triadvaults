import * as THREE from 'three';
import { CameraShake } from './CameraShake.js';

/** Cuánto se adelanta la mirada en la dirección del movimiento, en unidades. */
const LOOK_AHEAD = 2.2;

const BASE_FOV = 50;

/**
 * Topes de la compensación para ventanas estrechas.
 *
 * `fov` es el **vertical** en Three.js, así que al estrechar la ventana el campo
 * horizontal se desploma —de unos 79° a 24° en un móvil— y de la sala solo queda
 * una franja. Recuperarlo solo con el ángulo pediría más de 120°, que deforma la
 * imagen hasta marear, así que se reparte entre abrir el ángulo y **alejar la
 * cámara**, cada uno con su tope.
 */
const MAX_FOV = 70;
const MAX_DISTANCE_SCALE = 2.2;

/**
 * Escalones de zoom del jugador, como multiplicadores de la distancia de la cámara.
 *
 * **Menos es más cerca**: son un factor sobre el desplazamiento, no una ampliación. El
 * 1 es el encuadre de siempre, así que quien no toque el zoom ve exactamente lo que
 * veía antes de que esto existiera.
 *
 * Los topes no son gratuitos por debajo: acercándose mucho, la sala deja de caber y
 * un compañero al otro extremo desaparece de la pantalla, que en un juego cooperativo
 * de sincronizar placas es perder información. Por eso el más cercano se queda en 0,62
 * y no en la mitad.
 */
const ZOOM_STEPS = [0.62, 0.8, 1, 1.25, 1.55];
const MIN_ZOOM = ZOOM_STEPS[0];
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

const ZOOM_STORAGE_KEY = 'triad_zoom';

/**
 * Suavizado del zoom, en unidades de `MathUtils.damp`.
 *
 * El zoom se interpola hacia su objetivo en vez de saltar: un corte seco de distancia
 * en una cámara que ya persigue al jugador se lee como un tirón del motor, no como una
 * acción del jugador. Con esto, pulsar el botón es un movimiento de cámara.
 */
const ZOOM_DAMPING = 7;

function loadZoom() {
  try {
    const saved = Number(localStorage.getItem(ZOOM_STORAGE_KEY));
    if (Number.isFinite(saved) && saved > 0) return THREE.MathUtils.clamp(saved, MIN_ZOOM, MAX_ZOOM);
  } catch {
    // Sin almacenamiento (modo privado, Electron sin perfil) el zoom simplemente no
    // se recuerda; no es motivo para dejar al jugador sin cámara.
  }
  return 1;
}

export class EngineCamera {
  constructor() {
    this.aspect = window.innerWidth / window.innerHeight;
    // `far` a 200: la sala más grande mide 36 unidades y la niebla cierra el
    // horizonte mucho antes. Con 1000 solo se perdía precisión del búfer de
    // profundidad, que en las GPU móviles suele ser de 16 bits.
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, this.aspect, 0.1, 200);

    /** Alejamiento para que la sala quepa en la ventana. Lo calcula `applyAspect`. */
    this.aspectScale = 1;
    /**
     * Zoom del jugador, encima del encuadre automático. `zoomTarget` es lo que se pide
     * y `zoom` lo que se está aplicando: entre los dos está el suavizado.
     *
     * Es una preferencia, no un estado de partida: sobrevive a `reset()` y al nivel.
     */
    this.zoomTarget = loadZoom();
    this.zoom = this.zoomTarget;
    /**
     * Semiejes de la sala en curso, con margen. Los fija `setRoomBounds` al construir el
     * nivel y sirven para dos cosas: encuadrarla entera y no dejar que la vista se salga
     * de ella. Ver `applyAspect` y `clampToRoom`.
     */
    this.roomHalf = null;
    /**
     * Huella de suelo que se ve, **relativa al punto al que mira la cámara**. Como el
     * desplazamiento y la orientación no cambian mientras se juega, esta huella es la
     * misma en toda la sala: se recalcula al cambiar la ventana o el zoom, no por
     * fotograma. Ver `measureGroundView`.
     */
    this.groundView = null;
    this.baseOffset = new THREE.Vector3(0, 24, 18);
    this.offset = this.baseOffset.clone();
    this.target = new THREE.Vector3(0, 0, 0);
    this.smoothFactor = 0.12;

    this.shake = new CameraShake();
    this.lookAhead = new THREE.Vector3();
    this.lastPosition = new THREE.Vector3();
    this.hasLastPosition = false;
    this.scratch = new THREE.Vector3();
    this.lookPoint = new THREE.Vector3();
    /** Zoom con el que se midió `groundView`, para no repetir la medida cada fotograma. */
    this.measuredZoom = this.zoomTarget;

    /** Ejes de pantalla proyectados al suelo. Los consume `EngineInput`; ver `updateGroundBasis`. */
    this.groundRight = new THREE.Vector3(1, 0, 0);
    this.groundForward = new THREE.Vector3(0, 0, -1);
    this.groundBasis = { right: this.groundRight, forward: this.groundForward };
    this.updateGroundBasis();

    this.applyAspect(this.aspect);
    this.camera.position.copy(this.offset);
    this.camera.lookAt(this.target);
  }

  /**
   * Recalcula a qué dirección del mundo corresponden "derecha" y "arriba" en pantalla.
   *
   * Existe porque esa correspondencia **estaba escrita a mano en el módulo de entrada**,
   * y se desincronizó: `Input` rotaba el vector 45° dando por hecho que la cámara era
   * isométrica, cuando `baseOffset` no tiene ninguna componente en X y por tanto no está
   * girada. El resultado era que empujar el stick hacia arriba movía al agente en
   * diagonal. Derivándolo de la cámara, mover `baseOffset` ya no puede volver a romper
   * el control.
   *
   * Se calcula sobre `baseOffset` y no sobre la matriz de la cámara a propósito: la
   * matriz lleva encima la sacudida por daño, y no tendría ningún sentido que un golpe
   * torciera la dirección en la que anda el jugador.
   */
  updateGroundBasis() {
    // La cámara mira desde `target + offset` hacia `target`, así que en el plano del
    // suelo avanza en sentido contrario al desplazamiento.
    this.groundForward.set(-this.baseOffset.x, 0, -this.baseOffset.z);
    if (this.groundForward.lengthSq() === 0) {
      // Cenital pura: no hay "hacia dónde mira" que proyectar. Se toma -Z, que es lo
      // que ve el jugador como "arriba" en una vista sin inclinar.
      this.groundForward.set(0, 0, -1);
    }
    this.groundForward.normalize();
    // right = forward × arriba
    this.groundRight.set(-this.groundForward.z, 0, this.groundForward.x);
  }

  /**
   * Base de movimiento para `EngineInput.getMovementVector`.
   *
   * @returns {{right: THREE.Vector3, forward: THREE.Vector3}} vectores unitarios en el
   *   plano XZ; **no modificar**, son los de la instancia.
   */
  getGroundBasis() {
    return this.groundBasis;
  }

  updateAspect(width, height) {
    this.applyAspect(width / height);
  }

  /**
   * Sala que hay que encuadrar y dentro de la cual se queda la vista.
   *
   * Lo llama el controlador de nivel al construir la bóveda. Sin este dato la única
   * referencia posible era la sala **más grande** del juego (36 unidades), y encuadrar
   * siempre para ese peor caso dejaba la sala del nivel 1 —que mide 20— como un
   * recuadro pequeño en mitad de una pantalla vacía.
   *
   * Los dos ejes van por separado y no como una única medida mayor: una sala de 36×20
   * se puede recorrer a lo largo pero no a lo ancho, y en una pantalla apaisada y baja
   * —un móvil tumbado— el eje que no cabe es justo el que la medida mayor escondía.
   *
   * @param {number} sizeX
   * @param {number} sizeZ
   * @param {number} margin cuánto se deja ver más allá del muro perimetral
   */
  setRoomBounds(sizeX, sizeZ, margin = 2.4) {
    this.roomHalf = sizeX > 0 && sizeZ > 0
      ? { x: sizeX / 2 + margin, z: sizeZ / 2 + margin }
      : null;
    this.applyAspect(this.aspect);
  }

  /**
   * Trozo de suelo que entra en pantalla, en coordenadas relativas al punto de mira.
   *
   * Se obtiene proyectando hacia atrás las cuatro esquinas de la imagen y cortándolas
   * contra el plano del suelo, en vez de con una fórmula de trigonometría: la cámara
   * está **inclinada** 53°, así que lo que se ve del suelo no es un rectángulo centrado
   * sino un trapecio —se ve mucho más lejos hacia el fondo que hacia delante—, y
   * cualquier aproximación simétrica deja una franja muerta arriba o recorta la sala
   * abajo. Ése era exactamente el fallo del encuadre anterior.
   *
   * Los cuatro rayos siempre cortan el suelo: con la inclinación de esta cámara y el
   * ángulo máximo (70°), el borde superior de la imagen sigue apuntando 18° por debajo
   * del horizonte, así que el horizonte nunca entra en cuadro.
   *
   * @param {number} distanceScale multiplicador de distancia con el que medir
   */
  computeGroundQuad(distanceScale) {
    const probe = new THREE.PerspectiveCamera(this.camera.fov, this.aspect, 0.1, 200);
    probe.position.copy(this.baseOffset).multiplyScalar(distanceScale);
    probe.lookAt(0, 0, 0);
    probe.updateMatrixWorld(true);
    probe.updateProjectionMatrix();

    const corner = new THREE.Vector3();

    // En este orden las cuatro esquinas de la imagen recorren el trapecio del suelo sin
    // cruzarse: cerca-izquierda, cerca-derecha, lejos-derecha, lejos-izquierda. Un orden
    // cualquiera daría un polígono en forma de lazo y todos los cortes saldrían mal.
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([nx, ny]) => {
      corner.set(nx, ny, 1).unproject(probe).sub(probe.position);
      // Parámetro del rayo que lleva la altura a 0. `corner.y` es siempre negativo
      // aquí: los cuatro rayos bajan hacia el suelo.
      const hit = corner.multiplyScalar(-probe.position.y / corner.y).add(probe.position);
      return { x: hit.x, z: hit.z };
    });
  }

  /**
   * Caja envolvente del trapecio —lo que necesita el confinamiento— y si la sala cabe
   * entera **con el zoom puesto ahora mismo**.
   *
   * Las dos cosas van juntas porque dependen de lo mismo. Y `roomFits` se recalcula
   * aquí, y no solo al encuadrar, porque el jugador puede acercarse hasta que la sala
   * deje de caber: en ese momento la cámara tiene que volver a seguirle en vez de
   * quedarse clavada en el centro.
   */
  measureGroundView() {
    const scale = this.aspectScale * this.zoom;
    const quad = this.computeGroundQuad(scale);

    this.groundView = {
      minX: Math.min(...quad.map(p => p.x)),
      maxX: Math.max(...quad.map(p => p.x)),
      minZ: Math.min(...quad.map(p => p.z)),
      maxZ: Math.max(...quad.map(p => p.z))
    };
    this.roomFits = Boolean(this.roomHalf) && this.roomCoverage(scale) <= 1.001;
  }

  /**
   * Cuánto habría que ampliar la vista para que la sala entera cupiera. 1 o menos = ya cabe.
   *
   * Se comprueban **las cuatro esquinas de la sala contra el trapecio**, no las medidas
   * contra su caja envolvente. La diferencia no es un detalle: la caja incluye el fondo
   * lejano del trapecio, que solo se ve en una franja estrecha en lo alto de la pantalla,
   * así que daba por cubierta una profundidad que en los laterales no existe. Con esa
   * cuenta, un móvil tumbado se declaraba encuadrado mientras cortaba la sala por arriba
   * y por abajo.
   *
   * Se apoya en que el trapecio crece **en proporción** a la distancia del ojo —es una
   * semejanza—, así que alejar la cámara `k` veces equivale a encoger la sala `k` veces:
   * el factor que falta sale de un solo corte por esquina, sin iterar.
   */
  roomCoverage(distanceScale) {
    if (!this.roomHalf) return 1;

    const quad = this.computeGroundQuad(distanceScale);
    const { x: halfX, z: halfZ } = this.roomHalf;
    let needed = 1;

    for (const [cx, cz] of [[-halfX, -halfZ], [halfX, -halfZ], [halfX, halfZ], [-halfX, halfZ]]) {
      const distance = Math.hypot(cx, cz);
      if (distance === 0) continue;
      const exit = this.quadExitDistance(cx / distance, cz / distance, quad);
      if (exit > 0) needed = Math.max(needed, distance / exit);
    }

    return needed;
  }

  /**
   * Distancia desde el punto de mira hasta el borde del trapecio, en la dirección dada.
   *
   * El punto de mira es el centro de la imagen, así que siempre está dentro del polígono
   * y el rayo sale por exactamente un lado.
   *
   * @param {number} dx dirección unitaria en X
   * @param {number} dz dirección unitaria en Z
   * @param {Array<{x: number, z: number}>} quad
   */
  quadExitDistance(dx, dz, quad) {
    let best = 0;

    for (let i = 0; i < quad.length; i++) {
      const a = quad[i];
      const b = quad[(i + 1) % quad.length];
      const ex = b.x - a.x;
      const ez = b.z - a.z;

      const denominator = ex * dz - ez * dx;
      if (Math.abs(denominator) < 1e-9) continue; // rayo paralelo al lado

      // `s` recorre el lado (0..1) y `t` es la distancia sobre el rayo. El despeje de
      // `t` se hace por la componente **del rayo** que más lejos esté de cero; con la
      // otra, una dirección casi paralela a un eje dividiría por casi nada.
      const s = (a.z * dx - a.x * dz) / denominator;
      if (s < 0 || s > 1) continue;
      const t = Math.abs(dx) > Math.abs(dz)
        ? (a.x + ex * s) / dx
        : (a.z + ez * s) / dz;
      if (t > 0) best = best === 0 ? t : Math.min(best, t);
    }

    return best;
  }

  /**
   * Recorta el punto de mira para que la vista no se salga de la sala.
   *
   * Es la diferencia entre "la cámara sigue al jugador" y "la cámara encuadra la
   * partida": sin esto, pegarse a un muro gastaba media pantalla en el vacío de fuera,
   * y en una sala que no cabe entera la parte que sí cabe se escapaba por un lado.
   *
   * Cuando la sala es **más pequeña** que lo que se ve, no hay nada que recortar y la
   * cámara se queda fija en su centro: moverse por dentro deja de mover la imagen, que
   * es exactamente lo que hace que una sala pequeña se lea como una habitación y no
   * como un trozo de mapa a la deriva.
   *
   * @param {THREE.Vector3} target punto de mira; se modifica en el sitio
   */
  clampToRoom(target) {
    if (!this.roomHalf || !this.groundView) return target;

    // Si la sala cabe entera, el encuadre correcto es su centro y no hay nada que
    // seguir. Se mira al centro **de la sala** y no al centro de la huella visible:
    // son cosas distintas, porque la huella es un trapecio y su caja envolvente está
    // sesgada hacia el fondo. Centrando la caja, la sala se quedaba pegada a un lado
    // con un hueco muerto en el otro, que es justo lo que se venía a arreglar.
    if (this.roomFits) {
      target.x = 0;
      target.z = 0;
      return target;
    }

    const { minX, maxX, minZ, maxZ } = this.groundView;
    const { x: halfX, z: halfZ } = this.roomHalf;

    // Márgenes disponibles a cada lado. Si en un eje la huella es mayor que la sala,
    // los dos salen cruzados y el punto medio deja ese eje centrado.
    const lowX = -halfX - minX;
    const highX = halfX - maxX;
    target.x = lowX > highX ? (lowX + highX) / 2 : THREE.MathUtils.clamp(target.x, lowX, highX);

    const lowZ = -halfZ - minZ;
    const highZ = halfZ - maxZ;
    target.z = lowZ > highZ ? (lowZ + highZ) / 2 : THREE.MathUtils.clamp(target.z, lowZ, highZ);

    return target;
  }

  /**
   * Encuadre para la ventana actual.
   *
   * Se mide **la huella real de suelo** contra los dos ejes de la sala y lo que falte
   * se cubre con dos mandos en este orden: primero abriendo el ángulo, y lo que quede,
   * alejando la cámara. Si con el ángulo original ya cabe —cualquier monitor—, no se
   * toca nada: `fov` se queda en 50 y la distancia en 1, que es el encuadre de siempre.
   *
   * El orden importa: alejar la cámara empequeñece al agente, así que se usa como
   * último recurso; abrir el ángulo cuesta algo de deformación pero conserva el tamaño
   * de lo que hay en el centro.
   *
   * La versión anterior solo miraba el eje **horizontal**, con una fórmula sobre la
   * medida mayor de la sala. En un monitor daba igual porque sobra ancho, pero en un
   * móvil tumbado (2,2:1) lo que no cabe es el fondo, y la sala se salía por arriba y
   * por abajo sin que nada lo compensara: se jugaba viendo una franja.
   */
  applyAspect(aspect) {
    this.aspect = aspect;
    this.camera.aspect = aspect;
    this.camera.fov = BASE_FOV;
    this.aspectScale = 1;
    this.camera.updateProjectionMatrix();

    if (this.roomHalf) {
      // El encuadre automático se calcula con el zoom **a 1**: es la distancia base de
      // la sala, y lo que el jugador elija se multiplica encima.
      const needed = this.roomCoverage(this.aspectScale);
      if (needed > 1) {
        // Lo que da el ángulo: la huella escala con la tangente del semiángulo, así que
        // ésta es la apertura que multiplicaría la huella por `needed`.
        const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV) / 2) * needed);
        this.camera.fov = Math.min(MAX_FOV, THREE.MathUtils.radToDeg(half) * 2);
        this.camera.updateProjectionMatrix();

        // Y lo que quede, alejando. Se vuelve a medir en vez de restar: al inclinar la
        // cámara, abrir el ángulo agranda el fondo del trapecio más que el frente, y
        // ese reparto desigual no se deduce de la cuenta anterior.
        this.aspectScale = Math.min(
          MAX_DISTANCE_SCALE,
          Math.max(1, this.roomCoverage(this.aspectScale))
        );
      }
    }

    // Fija `groundView` y `roomFits`: puede seguir sin caber, porque el alejamiento
    // tiene tope y porque el jugador puede tener el zoom muy acercado.
    this.measureGroundView();
  }

  // ------------------------------------------------------------------ zoom

  /**
   * Fija el zoom y lo recuerda entre sesiones.
   *
   * @param {number} value multiplicador de distancia; se recorta a los topes
   * @returns {number} el valor realmente aplicado
   */
  setZoom(value) {
    this.zoomTarget = THREE.MathUtils.clamp(value, MIN_ZOOM, MAX_ZOOM);
    try {
      localStorage.setItem(ZOOM_STORAGE_KEY, String(this.zoomTarget));
    } catch {
      // Ver `loadZoom`: sin almacenamiento el zoom funciona, solo no se recuerda.
    }
    return this.zoomTarget;
  }

  /**
   * Zoom continuo, para la rueda del ratón y el pellizco.
   *
   * El paso es **proporcional** al zoom actual y no una cantidad fija: de cerca, un
   * mismo incremento de distancia se nota mucho más que de lejos, así que sumar
   * siempre lo mismo da un control que salta al principio del recorrido y se atasca al
   * final.
   *
   * @param {number} delta positivo aleja, negativo acerca
   */
  nudgeZoom(delta) {
    return this.setZoom(this.zoomTarget * (1 + delta));
  }

  /**
   * Siguiente escalón de zoom, dando la vuelta al llegar al final.
   *
   * Es lo que hace el botón: un único control para las dos direcciones, porque en un
   * móvil dos botones más en la esquina se comen el sitio que necesita el pulgar.
   *
   * Recorre los escalones **acercándose**, que es lo que espera quien pulsa algo que
   * pone "zoom"; al llegar al más cercano vuelve al más lejano. Y se parte del escalón
   * más próximo al valor actual —no del último pulsado— para que seguir con el botón
   * después de haber usado la rueda no dé un salto hacia atrás.
   */
  cycleZoom() {
    let nearest = 0;
    ZOOM_STEPS.forEach((step, i) => {
      if (Math.abs(step - this.zoomTarget) < Math.abs(ZOOM_STEPS[nearest] - this.zoomTarget)) nearest = i;
    });
    return this.setZoom(ZOOM_STEPS[(nearest - 1 + ZOOM_STEPS.length) % ZOOM_STEPS.length]);
  }

  /**
   * Zoom como porcentaje para el botón: 100 % es el encuadre por defecto y los valores
   * altos son más cerca. Se invierte porque para el jugador "más zoom" es ver más
   * grande, mientras que por dentro es una distancia.
   */
  get zoomPercent() {
    return Math.round(100 / this.zoomTarget);
  }

  /** Sacudida por daño, apertura de compuerta, etc. `amount` de 0 a 1. */
  addShake(amount) {
    this.shake.add(amount);
  }

  /**
   * Sigue al jugador local.
   *
   * Dos detalles que cambian mucho la sensación: el punto de mira se adelanta en la
   * dirección del movimiento (se ve a dónde vas, no de dónde vienes), y la sacudida
   * se suma después del suavizado, para que no se la coma el `lerp`.
   */
  follow(targetPosition, delta = 0.016) {
    if (!targetPosition) return;

    this.zoom = THREE.MathUtils.damp(this.zoom, this.zoomTarget, ZOOM_DAMPING, delta);
    this.offset.copy(this.baseOffset).multiplyScalar(this.aspectScale * this.zoom);

    // Velocidad estimada a partir del desplazamiento real, sin depender del input:
    // así también se adelanta al empujar contra un muro o al deslizar.
    if (this.hasLastPosition) {
      this.scratch.subVectors(targetPosition, this.lastPosition);
      if (delta > 0) this.scratch.divideScalar(delta);
      this.scratch.y = 0;
      this.lookAhead.lerp(this.scratch.clampLength(0, 10).multiplyScalar(LOOK_AHEAD / 10), 0.08);
    }
    this.lastPosition.copy(targetPosition);
    this.hasLastPosition = true;

    // La huella de suelo depende de la distancia, así que se vuelve a medir mientras el
    // zoom se está moviendo; una vez asentado, la comparación la salta.
    if (Math.abs(this.zoom - this.measuredZoom) > 0.002) {
      this.measuredZoom = this.zoom;
      this.measureGroundView();
    }

    // Se recorta el punto de mira ANTES de derivar de él la posición del ojo: si se
    // recortara la posición, el ojo y el objetivo dejarían de guardar el desplazamiento
    // fijo y la cámara se iría girando sola contra los muros.
    const look = this.clampToRoom(this.lookPoint.copy(targetPosition).add(this.lookAhead));

    this.target.lerp(look, this.smoothFactor);
    this.camera.position.lerp(this.scratch.copy(look).add(this.offset), this.smoothFactor);
    this.camera.lookAt(this.target);

    const { offset, roll } = this.shake.update(delta);
    if (this.shake.isActive) {
      this.camera.position.add(offset);
      this.camera.rotateZ(roll);
    }
  }

  /**
   * Al arrancar un nivel la cámara no debe arrastrar la inercia del anterior.
   *
   * El zoom **no** se reinicia —es una preferencia del jugador, no estado de partida—,
   * pero sí se le quita el suavizado: el nivel tiene que empezar ya a la distancia
   * elegida, no acercándose durante el primer segundo.
   */
  reset() {
    this.shake.reset();
    this.lookAhead.set(0, 0, 0);
    this.hasLastPosition = false;
    this.zoom = this.zoomTarget;
  }
}
