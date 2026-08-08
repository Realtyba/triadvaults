/**
 * Cede el control al hilo principal del navegador.
 *
 * Utilidad esencial para evitar los tirones ("stutters") y congelamientos de
 * la UI durante tareas pesadas (como la generación procedural o compilación de
 * geometría). Al hacer `await yieldToMain()`, el event loop tiene la
 * oportunidad de repintar la pantalla (animaciones, loader) y procesar input.
 *
 * Se usa `setTimeout(..., 0)` en lugar de `requestAnimationFrame` porque este
 * último puede agruparse en el mismo repintado, mientras que `setTimeout`
 * fuerza la cesión al task queue del navegador.
 *
 * @returns {Promise<void>}
 */
export function yieldToMain() {
  return new Promise(resolve => setTimeout(resolve, 0));
}
