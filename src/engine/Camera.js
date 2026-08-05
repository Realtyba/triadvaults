import * as THREE from 'three';

export class EngineCamera {
  constructor() {
    this.aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(50, this.aspect, 0.1, 1000);
    
    // Improved Top-Down Isometric Angle (Higher Y for full room visibility)
    this.zoomLevel = 1.0;
    this.baseOffset = new THREE.Vector3(0, 24, 18);
    this.offset = this.baseOffset.clone();
    this.target = new THREE.Vector3(0, 0, 0);
    this.smoothFactor = 0.12;

    this.camera.position.copy(this.offset);
    this.camera.lookAt(this.target);

    // Mouse Wheel Zoom
    window.addEventListener('wheel', (e) => this.onScroll(e), { passive: true });
  }

  onScroll(e) {
    if (e.deltaY > 0) {
      // Zoom out
      this.zoomLevel = Math.min(this.zoomLevel + 0.1, 1.8);
    } else {
      // Zoom in
      this.zoomLevel = Math.max(this.zoomLevel - 0.1, 0.6);
    }
    this.offset.copy(this.baseOffset).multiplyScalar(this.zoomLevel);
  }

  updateAspect(width, height) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  follow(targetPosition) {
    if (!targetPosition) return;
    
    // Target camera position with zoom factor
    const desiredPosition = targetPosition.clone().add(this.offset);
    this.camera.position.lerp(desiredPosition, this.smoothFactor);

    // Target look point
    this.target.lerp(targetPosition, this.smoothFactor);
    this.camera.lookAt(this.target);
  }
}
