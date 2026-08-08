#!/usr/bin/env node
/**
 * Comprueba que empujar el mando en una dirección mueve al agente en esa dirección.
 *
 * Suena obvio y por eso llevaba tiempo roto. `EngineInput` rotaba el vector 45°
 * apoyándose en un comentario que decía que la cámara era isométrica, mientras que
 * `EngineCamera.baseOffset` es `(0, 24, 18)` —sin componente en X, o sea sin ningún
 * giro—. El resultado: empujar hacia arriba llevaba al agente en diagonal hacia
 * arriba-izquierda. Con teclado casi no se nota, porque son cuatro direcciones
 * discretas y uno se acostumbra; con un pulgar analógico el control se siente roto,
 * que es exactamente lo que se reportó desde el móvil.
 *
 * Lo que se fija aquí es el **contrato**, no la implementación: sea cual sea el
 * encuadre que se elija mañana, lo que el jugador señala y hacia donde anda el agente
 * tienen que coincidir. Si alguien vuelve a mover `baseOffset` sin tocar la entrada,
 * esto falla.
 *
 * Va con los `validate:*` y no con los e2e a propósito: es geometría pura, no necesita
 * navegador, y así corre en un segundo en vez de levantar Chrome y la API.
 *
 * Uso: node scripts/validate-movement.js
 */
import * as THREE from 'three';

// `Input.js` y `Camera.js` se enganchan a `window` al construirse. Aquí no hay DOM, y
// montar jsdom por dos `addEventListener` sería mucho más caro que fingirlos.
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 800,
  addEventListener() {},
  removeEventListener() {}
};

const { EngineCamera } = await import('../src/engine/Camera.js');
const { EngineInput } = await import('../src/engine/Input.js');

/** Tolerancia angular. Un desvío real es de 45°; esto sólo absorbe el coma flotante. */
const EPSILON = 1e-6;

let failures = 0;

function check(condition, pass, fail) {
  if (condition) {
    console.log(`  ✓ ${pass}`);
  } else {
    console.error(`  ✗ ${fail}`);
    failures++;
  }
}

/**
 * Dirección de mundo que sale al empujar el mando hacia `(sx, sy)` en pantalla.
 * `sy` positivo es hacia abajo, que es el convenio de los eventos de puntero.
 */
function push(input, camera, sx, sy) {
  input.touch.announced = true;
  input.touch.vector.x = sx;
  input.touch.vector.y = sy;
  input.update();
  return input.getMovementVector(camera.getGroundBasis()).clone();
}

console.log('\nMovimiento: lo señalado contra lo andado\n');

const camera = new EngineCamera();
const input = new EngineInput();

// ------------------------------------------------ los cuatro sentidos cardinales

const screenUp = push(input, camera, 0, -1);
check(
  Math.abs(screenUp.x) < EPSILON && screenUp.z < 0,
  'arriba en pantalla → se aleja de la cámara, sin desvío lateral',
  `arriba en pantalla dio (${screenUp.x.toFixed(3)}, ${screenUp.z.toFixed(3)}); se esperaba x≈0 y z<0`
);

const screenDown = push(input, camera, 0, 1);
check(
  Math.abs(screenDown.x) < EPSILON && screenDown.z > 0,
  'abajo en pantalla → se acerca a la cámara, sin desvío lateral',
  `abajo en pantalla dio (${screenDown.x.toFixed(3)}, ${screenDown.z.toFixed(3)}); se esperaba x≈0 y z>0`
);

const screenRight = push(input, camera, 1, 0);
check(
  Math.abs(screenRight.z) < EPSILON && screenRight.x > 0,
  'derecha en pantalla → derecha del mundo, sin desvío en profundidad',
  `derecha en pantalla dio (${screenRight.x.toFixed(3)}, ${screenRight.z.toFixed(3)}); se esperaba z≈0 y x>0`
);

const screenLeft = push(input, camera, -1, 0);
check(
  Math.abs(screenLeft.z) < EPSILON && screenLeft.x < 0,
  'izquierda en pantalla → izquierda del mundo, sin desvío en profundidad',
  `izquierda en pantalla dio (${screenLeft.x.toFixed(3)}, ${screenLeft.z.toFixed(3)}); se esperaba z≈0 y x<0`
);

// --------------------------------------------------------- la base es coherente

const basis = camera.getGroundBasis();
check(
  Math.abs(basis.right.length() - 1) < 1e-6 && Math.abs(basis.forward.length() - 1) < 1e-6,
  'la base de la cámara es unitaria',
  'la base de la cámara no está normalizada'
);
check(
  Math.abs(basis.right.dot(basis.forward)) < 1e-6,
  'la base de la cámara es ortogonal',
  'los ejes de la base de la cámara no son perpendiculares'
);
check(
  basis.right.y === 0 && basis.forward.y === 0,
  'la base vive en el plano del suelo',
  'la base tiene componente vertical: el agente andaría hacia arriba o hacia abajo'
);

// ------------------------------------------- la base sigue a la cámara, no al revés

// Se gira el encuadre 90°: si la entrada volviera a llevar una rotación escrita a mano,
// esto se quedaría apuntando al sitio de antes.
camera.baseOffset.set(18, 24, 0);
camera.updateGroundBasis();
const turned = push(input, camera, 0, -1);
check(
  Math.abs(turned.z) < EPSILON && turned.x < 0,
  'al girar el encuadre 90°, "arriba" gira con él',
  `con el encuadre girado, arriba dio (${turned.x.toFixed(3)}, ${turned.z.toFixed(3)}); se esperaba z≈0 y x<0`
);

// ------------------------------------------------------------- el módulo analógico

camera.baseOffset.set(0, 24, 18);
camera.updateGroundBasis();

const half = push(input, camera, 0, -0.5);
check(
  Math.abs(half.length() - 0.5) < 1e-6,
  'a medio recorrido el módulo es 0,5: el agente anda despacio',
  `a medio recorrido el módulo fue ${half.length().toFixed(3)} en vez de 0,5`
);

const diagonal = push(input, camera, 1, -1);
check(
  diagonal.length() <= 1 + 1e-6,
  'en diagonal el módulo no pasa de 1: no se corre más de lado',
  `en diagonal el módulo fue ${diagonal.length().toFixed(3)}, por encima de 1`
);

console.log(
  failures === 0
    ? '\n✅ El agente anda hacia donde se le señala.\n'
    : `\n❌ ${failures} comprobación(es) fallida(s).\n`
);
process.exit(failures === 0 ? 0 : 1);
