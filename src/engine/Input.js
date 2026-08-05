import * as THREE from 'three';

export class EngineInput {
  constructor() {
    this.keys = {
      up: false,
      down: false,
      left: false,
      right: false,
      interact: false
    };

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
  }

  onKeyDown(e) {
    if (['ArrowUp', 'KeyW'].includes(e.code)) this.keys.up = true;
    if (['ArrowDown', 'KeyS'].includes(e.code)) this.keys.down = true;
    if (['ArrowLeft', 'KeyA'].includes(e.code)) this.keys.left = true;
    if (['ArrowRight', 'KeyD'].includes(e.code)) this.keys.right = true;
    if (['Space', 'KeyE'].includes(e.code)) this.keys.interact = true;
  }

  onKeyUp(e) {
    if (['ArrowUp', 'KeyW'].includes(e.code)) this.keys.up = false;
    if (['ArrowDown', 'KeyS'].includes(e.code)) this.keys.down = false;
    if (['ArrowLeft', 'KeyA'].includes(e.code)) this.keys.left = false;
    if (['ArrowRight', 'KeyD'].includes(e.code)) this.keys.right = false;
    if (['Space', 'KeyE'].includes(e.code)) this.keys.interact = false;
  }

  getMovementVector() {
    const move = new THREE.Vector3(0, 0, 0);

    // Iso movement direction
    if (this.keys.up) {
      move.x -= 1;
      move.z -= 1;
    }
    if (this.keys.down) {
      move.x += 1;
      move.z += 1;
    }
    if (this.keys.left) {
      move.x -= 1;
      move.z += 1;
    }
    if (this.keys.right) {
      move.x += 1;
      move.z -= 1;
    }

    if (move.lengthSq() > 0) {
      move.normalize();
    }

    return move;
  }
}
