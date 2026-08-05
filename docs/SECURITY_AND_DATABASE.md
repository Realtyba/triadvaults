# Triad Vaults - Documentación de Seguridad y Base de Datos

Documentación de la capa de persistencia PostgreSQL, encriptación de contraseñas, migraciones y privacidad.

---

## 🔒 Medidas de Seguridad Implementadas

### 1. **Hashing Seguro de Contraseñas (PBKDF2 SHA-512)**
- **Nunca se almacenan contraseñas en texto plano**.
- Cada usuario recibe una **Sal aleatoria de 16 bytes** generada criptográficamente con `crypto.randomBytes()`.
- La contraseña se procesa con `crypto.pbkdf2Sync` (10,000 iteraciones, SHA-512) y se almacena en el formato `salt:hash`.

### 2. **Sanitización de Respuestas de Error**
- El servidor Node.js captura las excepciones de PostgreSQL y retorna únicamente mensajes amigables al cliente sin exponer cadenas de conexión, contraseñas o detalles de infraestructura interna.

### 3. **Restricciones de Unicidad y Prevención de Duplicados**
- Columnas `username` y `email` definidas con restricción `UNIQUE` en PostgreSQL.
- Búsqueda insensible a mayúsculas (`LOWER(username)` y `LOWER(email)`).

---

## 🗄️ Esquema de la Base de Datos PostgreSQL

```sql
CREATE TABLE IF NOT EXISTS triad_game_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    reset_code VARCHAR(10) DEFAULT NULL,
    max_level_reached INTEGER DEFAULT 1,
    total_puzzles_solved INTEGER DEFAULT 0,
    is_online BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

---

## 🛠️ Sistema de Migraciones SQL

Las migraciones se encuentran centralizadas en la carpeta [game/migrations](file:///home/jvelasquez/realtyba-project/game/migrations).

### Ejecutar Migraciones:
```bash
cd game
npm run migrate
```

O especificando una base de datos remota de producción:
```bash
DATABASE_URL="postgres://usuario:password@host_servidor:5432/nombre_db" npm run migrate
```
