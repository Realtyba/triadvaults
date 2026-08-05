# Triad Vaults - Documentación de Arquitectura del Sistema

Visión general de la arquitectura técnica, motor gráfico 3D, generador procedural, comunicación en tiempo real y sistema de internacionalización (i18n).

---

## 🏛️ Visión General de la Arquitectura

```
                        +---------------------------------------+
                        |      Aplicación Cliente (Browser /    |
                        |            Electron Steam)            |
                        +-------------------+-------------------+
                                            |
                         +------------------+------------------+
                         |                                     |
                         v                                     v
            +------------------------+             +-----------------------+
            |    Motor Gráfico 3D    |             |  Interfaz UI / HUD    |
            |      (Three.js)        |             |  (i18n, Glassmorphism)|
            +-----------+------------+             +-----------+-----------+
                        |                                      |
                        +------------------+-------------------+
                                           |
                                           v
                            +-----------------------------+
                            | Network Client (Socket.io)  |
                            +--------------+--------------+
                                           |
                                           v  (WebSockets / HTTP)
                            +--------------+--------------+
                            | Servidor Node.js Express    |
                            +--------------+--------------+
                                           |
                                           v
                            +--------------+--------------+
                            | Base de Datos PostgreSQL    |
                            |   (Contenedor Local / Cloud)|
                            +-----------------------------+
```

---

## 📦 Módulos Principales

### 1. **Motor 3D y Renderizado (`src/engine/`)**
- **`Renderer.js`**: Instancia `THREE.WebGLRenderer` con sombras PCFSoft, mapa de sombras suave de 2048px, niebla de profundidad y mapas de tono ACESFilmic.
- **`Camera.js`**: Cámara de perspectiva isométrica con ángulo elevado y seguimiento lerp del jugador activo. Soporta **Zoom dinámico con la rueda del ratón (`Mouse Wheel`)**.
- **`Lighting.js`**: Sistema de antorchas neón en las 4 esquinas de cada sala y luz direccional dinámica con proyección de sombras.
- **`Input.js`**: Captura teclado (`WASD` y `Flechas`).

### 2. **Generación Procedural (`src/procedural/`)**
- **`DungeonGen.js`**: Genera salas 3D con semillas aleatorias visibles (ej. `#8491`), varias dimensiones y paletas de color neón (Cúan, Magenta, Esmeralda, Ámbar, Púrpura).
- **`PuzzleGen.js`**: Genera placas de presión adaptadas **exactamente** al número de jugadores conectados en la sala (1 para solo, 2 para dúo, 3 para escuadrón).

### 3. **Entidades del Juego (`src/entities/`)**
- **`Player.js`**: Personaje 3D con física de **Deslizamiento en Paredes (Wall Sliding)** para evitar trabarse al caminar en diagonal y rotación suave slerp.
- **`GhostEnemy.js`**: Fantasma cazador 3D ("Glitch Stalker") que busca al jugador más cercano. Su velocidad escala con el nivel.
- **`PuzzleElement.js`**: Compuertas de energía y placas de presión.

### 4. **Internacionalización i18n (`src/i18n/` & `src/locales/`)**
- `es.json` y `en.json` contienen los pares clave-valor de traducción.
- `I18nManager.js` traduce la interfaz en tiempo real y guarda la preferencia en `localStorage`.

---

## 🔄 Flujo de Sincronización Multijugador

1. **Host (Creador de Sala)**:
   - Calcula el movimiento del enemigo Fantasma y transmite la posición vía WebSockets (`ghost_move`).
   - Notifica la finalización de nivel (`level_complete`).
2. **Clientes Conectados**:
   - Transmiten sus posiciones 3D (`player_move`) a 60 FPS.
   - Reciben eventos de actualización de salud y salas (`room_updated`).
