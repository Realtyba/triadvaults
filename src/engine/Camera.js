import * as THREE from 'three';
import { CameraShake } from './CameraShake.js';

/** Cuánto se adelanta la mirada en la dirección del movimiento, en unidades. */
const LOOK_AHEAD = 2.2;

/**
 * Suavizado del adelanto de la mirada, en unidades de `MathUtils.damp`.
 *
 * Mismo motivo que `FOLLOW_DAMPING`: era un factor fijo de 0,08 por fotograma, o sea
 * que en un panel de 120 Hz el adelanto se instalaba al doble de rápido. Equivale al
 * tacto anterior a 60 Hz: `-ln(1 - 0,08) · 60 ≈ 5,0`.
 */
const LOOK_AHEAD_DAMPING = 5;

const BASE_FOV = 50;

/**
 * Topes de la compensación para ventanas estrechas.
 *
 * `fov` es el **vertical** en Three.js, así que al estrechar la ventana el campo
 * horizontal se desploma —de unos 79° a 24° en un móvil— y de la sala solo queda
 * una franja. Recuperarlo solo con el ángulo pediría más de 120°, que deforma la
 * imagen hasta marear, así que se reparte entre abrir el ángulo y **alejar la
 * cámara**, cada uno con su tope.
 *
 * Los dos bajaron —de 70° y 2,2— al pasar la cámara a seguir al agente. Antes había
 * que encuadrar la sala **entera**, y en un móvil de pie eso salía tan caro que el
 * agente acababa siendo un punto: se gastaba todo el presupuesto en enseñar suelo
 * vacío del otro extremo. Garantizando solo `FRAME_HALF` alrededor del jugador la
 * cuenta sale mucho más barata, y lo que se compra con ella es que el personaje se
 * vea. Ver `applyAspect`.
 */
const MAX_FOV = 62;
const MAX_DISTANCE_SCALE = 1.5;

/**
 * Semiancho de juego que se garantiza ver alrededor del punto de mira, en unidades.
 *
 * Es lo que sustituye a "que quepa la sala entera" como objetivo del encuadre. El
 * valor sale de la sala del nivel 1 (20×20) más su margen: en la práctica esa sala
 * se sigue viendo completa, y a partir de ahí lo que crece es la sala, no la
 * distancia de la cámara.
 */
const FRAME_HALF = 13;

/**
 * Cuánto puede pasarse el punto de mira del muro perimetral, en unidades.
 *
 * Tiene que ser algo mayor que `LOOK_AHEAD`: el agente puede andar pegado al muro y el
 * adelanto de la mirada apunta entonces fuera de la sala. Recortando justo en el muro,
 * ese adelanto se comería contra el tope y el encuadre daría un tirón cada vez que
 * alguien camina contra una pared.
 */
const OVERSCAN = 4;

/**
 * Radio alrededor del punto de mira dentro del cual el agente no arrastra la cámara.
 *
 * Sin esto, cada corrección de un paso para pisar una placa desliza la sala entera y
 * la imagen no se queda quieta nunca. Con la zona muerta, los ajustes finos no mueven
 * nada y solo desplazarse de verdad mueve la vista.
 */
const DEAD_ZONE = 1.6;

/**
 * Suavizado del seguimiento, en unidades de `MathUtils.damp`.
 *
 * Antes era un `lerp` de factor fijo 0,12 por fotograma, que es **dependiente de la
 * tasa de refresco**: en un panel de 120 Hz la cámara se pegaba al doble de rápido
 * que en uno de 60. Mientras la vista estaba clavada en el centro de la sala apenas
 * se notaba; en cuanto sigue al jugador, es la diferencia entre dos juegos.
 *
 * El número reproduce el tacto anterior a 60 Hz: `-ln(1 - 0,12) · 60 ≈ 7,67`.
 */
const FOLLOW_DAMPING = 7.5;

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
     * nivel y son los que impiden que la vista se aleje de la bóveda. Ver `clampToRoom`.
     */
    this.roomHalf = null;
    /**
     * Semiejes que el encuadre garantiza ver alrededor del agente. Nunca mayores que
     * `roomHalf`, y nunca mayores que `FRAME_HALF`. Ver `applyAspect`.
     */
    this.frameHalf = null;
    this.baseOffset = new THREE.Vector3(0, 24, 18);
    this.offset = this.baseOffset.clone();
    this.target = new THREE.Vector3(0, 0, 0);

    this.shake = new CameraShake();
    this.lookAhead = new THREE.Vector3();
    this.lastPosition = new THREE.Vector3();
    this.hasLastPosition = false;
    this.scratch = new THREE.Vector3();
    this.lookPoint = new THREE.Vector3();

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

    // Lo que hay que encuadrar y lo que confina la vista dejaron de ser lo mismo al
    // pasar la cámara a seguir al agente. El confinamiento sigue siendo la sala —no
    // tiene sentido enseñar el vacío de fuera—, pero el encuadre solo garantiza una
    // burbuja alrededor del jugador: en una sala grande, exigir que quepa entera es
    // gastar todo el presupuesto de la Fase de ángulo y distancia en suelo lejano, y
    // el que se queda pequeño es el personaje. Ver `applyAspect` y `FRAME_HALF`.
    this.frameHalf = this.roomHalf
      ? { x: Math.min(this.roomHalf.x, FRAME_HALF), z: Math.min(this.roomHalf.z, FRAME_HALF) }
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
   * Cuánto habría que ampliar la vista para que quepa la burbuja de juego. 1 o menos = ya cabe.
   *
   * Mide contra `frameHalf` y no contra `roomHalf`: en una sala grande lo que se
   * garantiza es lo que rodea al agente, no la bóveda entera. Ver `setRoomBounds`.
   *
   * Se comprueban **las cuatro esquinas contra el trapecio**, no las medidas
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
    if (!this.frameHalf) return 1;

    const quad = this.computeGroundQuad(distanceScale);
    const { x: halfX, z: halfZ } = this.frameHalf;
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
   * Recorta el punto de mira para que no se vaya de la bóveda.
   *
   * ## Antes esto clavaba la cámara en el centro, y era el motivo de que no siguiera
   *
   * La versión anterior comparaba **la huella de suelo visible** con la sala: si cabía
   * entera, miraba a su centro y no seguía a nadie. La intención era buena —una sala
   * pequeña se lee como una habitación y no como un trozo de mapa a la deriva— pero el
   * efecto era que la cámara no seguía al jugador en la práctica totalidad de los
   * niveles, y para sostenerlo había que encuadrar la sala entera a costa del tamaño
   * del agente en pantalla.
   *
   * ## Por qué el recorte tampoco puede ir contra la huella
   *
   * Porque la huella es enorme comparada con la sala: la cámara mira en picado a 53° y
   * su trapecio de suelo mide unas **68×40 unidades** en un monitor 16:10, contra los
   * 24,8 de la sala del nivel 1. Recortar "que la huella no se salga" deja los dos
   * márgenes cruzados en todos los ejes y en todas las salas, o sea que centraría
   * siempre: sería el pin de antes escrito de otra forma.
   *
   * Y no hay nada que salvar ahí, porque **ese vacío ya se ve hoy**: con la cámara
   * centrada, una sala de 24,8 dentro de una huella de 68 enseña vacío a los dos lados.
   * Para eso están el plano del vacío y la niebla exponencial, que cierran el horizonte
   * mucho antes de que se note dónde acaba el suelo.
   *
   * ## Lo que sí hace falta
   *
   * Que la mirada no se vaya de la sala por su cuenta. El agente ya está siempre dentro,
   * así que esto es una red de seguridad para lo único que puede salirse solo: el
   * adelanto de `lookAhead`, que empuja el punto de mira hasta 2,2 unidades por delante
   * y contra un muro apuntaría fuera. `OVERSCAN` le deja ese margen justo.
   *
   * @param {THREE.Vector3} target punto de mira; se modifica en el sitio
   */
  clampToRoom(target) {
    if (!this.roomHalf) return target;

    const halfX = this.roomHalf.x + OVERSCAN;
    const halfZ = this.roomHalf.z + OVERSCAN;

    target.x = THREE.MathUtils.clamp(target.x, -halfX, halfX);
    target.z = THREE.MathUtils.clamp(target.z, -halfZ, halfZ);

    return target;
  }

  /**
   * Encuadre para la ventana actual.
   *
   * Se mide **la huella real de suelo** contra los dos ejes de la burbuja de juego
   * (`frameHalf`) y lo que falte se cubre con dos mandos en este orden: primero abriendo
   * el ángulo, y lo que quede, alejando la cámara. Si con el ángulo original ya cabe
   * —cualquier monitor—, no se toca nada: `fov` se queda en 50 y la distancia en 1, que
   * es el encuadre de siempre.
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

    if (this.frameHalf) {
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
   * Descuenta del punto de mira la zona muerta alrededor de donde ya se está mirando.
   *
   * Solo se persigue **el exceso**: dentro del radio la cámara no se entera de que el
   * agente se ha movido, y fuera de él va detrás del sobrante, no del total. Así los
   * ajustes de medio paso —colocarse sobre una placa, esquivar una esquina— dejan la
   * imagen quieta, y solo desplazarse de verdad la mueve.
   *
   * Se hace en el plano XZ y no en 3D: la altura del punto de mira no la decide el
   * jugador, y meterla en la cuenta solo añadiría ruido al radio.
   *
   * Va **después** de `clampToRoom`, no antes: el resultado se acerca a `this.target`,
   * que ya estaba confinado, así que no puede sacar la vista de la sala. Al revés, la
   * zona muerta podría devolver un punto que el confinamiento ya había rechazado.
   *
   * @param {THREE.Vector3} look punto de mira ya confinado; se modifica en el sitio
   */
  applyDeadZone(look) {
    const dx = look.x - this.target.x;
    const dz = look.z - this.target.z;
    const distance = Math.hypot(dx, dz);

    if (distance <= DEAD_ZONE) {
      look.x = this.target.x;
      look.z = this.target.z;
      return look;
    }

    const excess = (distance - DEAD_ZONE) / distance;
    look.x = this.target.x + dx * excess;
    look.z = this.target.z + dz * excess;
    return look;
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
      this.lookAhead.lerp(
        this.scratch.clampLength(0, 10).multiplyScalar(LOOK_AHEAD / 10),
        1 - Math.exp(-LOOK_AHEAD_DAMPING * delta)
      );
    }
    this.lastPosition.copy(targetPosition);
    this.hasLastPosition = true;

    // Se recorta el punto de mira ANTES de derivar de él la posición del ojo: si se
    // recortara la posición, el ojo y el objetivo dejarían de guardar el desplazamiento
    // fijo y la cámara se iría girando sola contra los muros.
    const look = this.clampToRoom(this.lookPoint.copy(targetPosition).add(this.lookAhead));

    this.applyDeadZone(look);

    // `damp` y no `lerp`: el factor fijo por fotograma ataba la velocidad de la cámara a
    // la tasa de refresco del panel. Ver `FOLLOW_DAMPING`.
    const smoothing = 1 - Math.exp(-FOLLOW_DAMPING * delta);
    this.target.lerp(look, smoothing);
    this.camera.position.lerp(this.scratch.copy(look).add(this.offset), smoothing);
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

  /**
   * Planta la cámara sobre un punto, sin suavizado.
   *
   * Hace falta porque la cámara **es una sola** para el menú y la partida. Mientras se
   * elige sala, `AmbientScene` la tiene orbitando a 34 unidades del centro; al empezar
   * el nivel, `follow` la traería desde allí amortiguada y el jugador vería un vuelo de
   * entrada de un par de segundos que nadie ha pedido y durante el cual ya se puede
   * mover.
   *
   * Se aplica el mismo confinamiento que en `follow` para que el primer fotograma esté
   * encuadrado igual que el segundo.
   *
   * @param {THREE.Vector3} position posición del agente local
   */
  snapTo(position) {
    if (!position) return;

    this.offset.copy(this.baseOffset).multiplyScalar(this.aspectScale * this.zoom);

    const look = this.clampToRoom(this.lookPoint.copy(position));
    this.target.copy(look);
    this.camera.position.copy(look).add(this.offset);
    this.camera.lookAt(this.target);

    this.lastPosition.copy(position);
    this.hasLastPosition = true;
  }
}
