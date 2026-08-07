/**
 * Liberación de recursos GPU.
 *
 * Three.js no libera geometrías ni materiales al quitar un objeto de la escena:
 * `scene.remove()` solo corta el enlace del grafo, los búferes siguen en la GPU.
 * Había cuatro copias de este recorrido y una de ellas —la de los puzles— se
 * quedó a medias: sacaba los nodos y la puerta de la escena sin disponerlos, así
 * que cada cambio de nivel perdía entre 8 y 24 objetos GPU que ya no volvían.
 */

/**
 * Saca un objeto de la escena y libera todo lo que cuelga de él.
 *
 * @param {import('three').Object3D} root
 * @param {import('three').Scene|import('three').Group} [parent] de dónde quitarlo
 */
export function disposeObject3D(root, parent = null) {
  if (!root) return;
  if (parent) parent.remove(root);
  else if (root.parent) root.parent.remove(root);

  root.traverse(child => {
    if (child.geometry && !isShared(child.geometry)) child.geometry.dispose();
    if (!child.material) return;

    // Un mesh puede llevar un array de materiales, uno por grupo de geometría.
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach(material => material && !isShared(material) && material.dispose());
  });
}

/**
 * ¿Es un recurso compartido entre niveles?
 *
 * El cubo unidad de los muros lo reutilizan todas las salas, así que liberarlo al
 * descargar un nivel dejaría sin geometría a los siguientes. Se marca con
 * `markShared` y estos recorridos lo respetan.
 */
function isShared(resource) {
  return !!(resource.userData && resource.userData.shared);
}

/** Marca una geometría o material como compartido entre niveles. */
export function markShared(resource) {
  resource.userData = resource.userData || {};
  resource.userData.shared = true;
  return resource;
}

/** Vacía un grupo liberando cada hijo. Devuelve el propio grupo, ya vacío. */
export function disposeChildren(group) {
  if (!group) return group;
  while (group.children.length > 0) {
    disposeObject3D(group.children[0], group);
  }
  return group;
}
