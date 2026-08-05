# Manual de Usuario - Triad Vaults

Bienvenido a **Triad Vaults**, un juego cooperativo de escape procedural en 3D (estilo Cyberpunk / Synthwave) donde los jugadores deben colaborar para superar acertijos dinámicos mientras son perseguidos por una amenaza implacable.

## 1. Controles Básicos
- **Movimiento:** Teclas `W`, `A`, `S`, `D` o las Flechas de Dirección. El personaje rotará de forma fluida hacia la dirección que te muevas.
- **Cámara:** Rueda del Ratón (Scroll) para acercar (Zoom In) o alejar (Zoom Out).
- **Pausa:** Tecla `Escape` para abrir el Menú de Pausa.

## 2. Mecánicas de Juego

### Objetivo Principal
Tu misión principal es **sobrevivir y escapar de la bóveda (nivel)**. 
- Cada nivel genera un laberinto de forma procedural y distribuye Placas de Presión (círculos luminosos en el suelo).
- El número de placas que deben pisarse simultáneamente es **igual al número de agentes conectados** en tu sala (de 1 a 3).
- Una vez activadas todas las placas correspondientes, el escudo protector de la puerta se desactivará y revelará la salida (marcada con neón verde brillante).

### Sistema de Vida y Regeneración de Mapa
- Comienzas con un Escudo de Energía al 100%. 
- Si tu escudo llega a 0%, habrás fracasado y tendrás que reiniciar el nivel actual.
- Si mueres **3 veces en el mismo nivel**, el juego te ofrecerá un botón para **"REGENERAR MAPA"**. Esto creará un diseño de laberinto completamente diferente para tu nivel actual (usando una alteración de semilla), ayudándote si te habías atascado en una configuración difícil.

### El Fantasma (La Amenaza)
Desde el momento en que inicias un nivel, una entidad corrupta (El Fantasma) se generará y te perseguirá por todo el laberinto.
- Se mueve en línea recta hacia el jugador más cercano.
- Cada vez que cruzas un nivel, **la velocidad del fantasma aumenta**. 
- A partir de niveles altos (nivel 15+), el Fantasma se mueve casi tan rápido como tu personaje (velocidad máxima limitada a 8.0). Debes evitar chocar con obstáculos, o te atrapará irremediablemente.
- Si el Fantasma te toca, tu escudo recibirá un gran daño (20%) y la pantalla reflejará el impacto con retroalimentación visual y de audio.

## 3. Multijugador y Salas
- En el Menú Principal, puedes crear una "Sala Privada/Pública" o unirte mediante el "Código de Sala".
- Al crear una sala, el juego usa tu nivel de progresión como base.
- Si un compañero se desconecta en mitad de la partida, el juego requiere que todos abandonen y reinicien la sala, ya que el sistema ajusta los acertijos (placas) a los jugadores exactos en el lobby.

## 4. Perfiles y Autenticación
- El juego guarda tu progreso máximo (Nivel Alcanzado y Acertijos Resueltos) en la Nube de Agentes (BBDD Postgres).
- Se requiere un nombre de agente y una contraseña para jugar.

## Consejos de Supervivencia
- Coordínate por chat de voz (si estás jugando con amigos). El fantasma cambia de objetivo hacia el jugador que tenga más cerca.
- Planea la ruta hacia las placas antes de moverte, especialmente en niveles altos donde un pequeño error de movimiento contra un muro significa ser alcanzado por el Fantasma.
- Utiliza el botón de `Regenerar Mapa` sabiamente si te frustra una semilla procedural en particular.

¡Buena suerte, Agente!
