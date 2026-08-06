import { app, BrowserWindow, shell, screen } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Tamaño y posición de la ventana entre sesiones. */
const DEFAULT_STATE = { width: 1280, height: 720 };

function stateFile() {
  return join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try {
    const saved = JSON.parse(readFileSync(stateFile(), 'utf-8'));

    // Una posición guardada puede caer fuera si se desconectó un monitor: se
    // descarta y la ventana vuelve al centro en vez de abrirse invisible.
    const visible = screen.getAllDisplays().some(display => {
      const b = display.bounds;
      return (
        saved.x !== undefined &&
        saved.x < b.x + b.width &&
        saved.x + saved.width > b.x &&
        saved.y < b.y + b.height &&
        saved.y + saved.height > b.y
      );
    });

    return visible ? saved : { width: saved.width, height: saved.height };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveWindowState(win) {
  if (win.isDestroyed() || win.isMinimized()) return;
  try {
    const bounds = win.isFullScreen() ? win.getNormalBounds() : win.getBounds();
    writeFileSync(stateFile(), JSON.stringify({ ...bounds, fullScreen: win.isFullScreen() }));
  } catch {
    // Perder la geometría no justifica impedir el cierre.
  }
}

function createWindow() {
  const state = loadWindowState();

  const win = new BrowserWindow({
    ...DEFAULT_STATE,
    ...state,
    minWidth: 960,
    minHeight: 600,
    title: 'Triad Vaults',
    backgroundColor: '#060812',
    show: false, // se muestra ya pintada: evita el destello blanco del arranque
    webPreferences: {
      // Los valores que Electron recomienda y que este proyecto no tenía.
      // El porqué está en electron/preload.cjs.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, 'preload.cjs')
    }
  });

  if (state.fullScreen) win.setFullScreen(true);
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());

  // Un enlace externo abre el navegador del sistema, nunca una ventana de la
  // aplicación sin restricciones.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Y tampoco se navega fuera del propio juego dentro de la ventana.
  win.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    if (target.origin !== 'http://localhost:3000' && target.protocol !== 'file:') {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  ['resize', 'move', 'close'].forEach(evt => win.on(evt, () => saveWindowState(win)));

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) win.loadURL('http://localhost:3000');
  else win.loadFile(join(__dirname, '../dist/index.html'));

  return win;
}

// Una segunda instancia no debe abrir otra ventana: enfoca la que ya está.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
