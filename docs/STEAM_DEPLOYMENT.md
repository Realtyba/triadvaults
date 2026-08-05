# Triad Vaults - Guía de Despliegue y Empaquetado para Steam

Instrucciones para generar el ejecutable (.exe / .app) para Steam usando Electron.

---

## 🛠️ Requisitos Previos

- Node.js v18+ y npm instalados.
- Electron instalado en el proyecto (`game/package.json`).

---

## 📦 Empaquetado para Steam

### 1. Construir el Bundle de Producción del Frontend
```bash
cd game
npm run build
```

### 2. Probar el Ejecutable Localmente con Electron
```bash
npm start
```

### 3. Generar el Binario `.exe` Instalable (Windows / Steam)
Instala `electron-builder`:
```bash
npm install electron-builder --save-dev
```

Añade la configuración a tu `package.json`:
```json
"build": {
  "appId": "com.triadvaults.game",
  "productName": "Triad Vaults",
  "files": [
    "dist/**/*",
    "electron/**/*"
  ],
  "directories": {
    "output": "release"
  }
}
```

Ejecuta la compilación:
```bash
npx electron-builder --win
```

El ejecutable instalable listo para subir a **Steamworks** se generará en la carpeta `game/release/`.
