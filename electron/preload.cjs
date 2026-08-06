const { contextBridge } = require('electron');

/**
 * Puente entre el proceso de render y el sistema.
 *
 * La ventana corría con `nodeIntegration: true` y `contextIsolation: false`, que
 * es la configuración que Electron desaconseja expresamente: cualquier script de
 * la página —o cualquier cadena que acabe en un `innerHTML`— tenía acceso a `fs`,
 * `child_process` y al resto de Node. Para un juego que además pinta nombres de
 * otros jugadores, eso convierte un XSS en ejecución de código en la máquina.
 *
 * Ahora la página está aislada y solo ve lo que se exponga aquí, de forma explícita.
 */
contextBridge.exposeInMainWorld('triad', {
  isDesktop: true,
  platform: process.platform,
  version: process.versions.electron
});
