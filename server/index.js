import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { RoomManager } from './rooms.js';
import { DatabaseManager } from './db.js';
import { sendVerificationPin } from './mailer.js';
import cors from 'cors';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_triad_key_123';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const roomManager = new RoomManager();

// Auth Endpoints
app.post('/api/register', async (req, res) => {
  const { firstName, lastName, username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ success: false, error: 'Ingresa Usuario, Correo y Contraseña.' });
  }
  const result = await DatabaseManager.registerUser(firstName, lastName, username, email, password);
  if (result.success) {
    const token = jwt.sign({ id: result.user.id, username: result.user.username }, JWT_SECRET, { expiresIn: '7d' });
    result.token = token;
    if (result.verificationCode) {
      sendVerificationPin(result.user.email, result.verificationCode, result.user.username);
      delete result.verificationCode; // Don't send it back to client
    }
  }
  res.json(result);
});

app.post('/api/login', async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.status(400).json({ success: false, error: 'Ingresa tu Usuario o Correo y Contraseña.' });
  }
  const result = await DatabaseManager.loginUser(identifier, password);
  if (result.success) {
    const token = jwt.sign({ id: result.user.id, username: result.user.username }, JWT_SECRET, { expiresIn: '7d' });
    result.token = token;
  }
  res.json(result);
});

app.post('/api/request-reset', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, error: 'Ingresa un correo electrónico.' });
  }
  const result = await DatabaseManager.requestPasswordReset(email);
  res.json(result);
});

app.post('/api/reset-password', async (req, res) => {
  const { email, resetCode, newPassword } = req.body;
  if (!email || !resetCode || !newPassword) {
    return res.status(400).json({ success: false, error: 'Por favor completa todos los campos.' });
  }
  const result = await DatabaseManager.resetPassword(email, resetCode, newPassword);
  res.json(result);
});

app.get('/api/leaderboard', async (req, res) => {
  const leaderboard = await DatabaseManager.getLeaderboard();
  res.json({ success: true, leaderboard });
});

app.post('/api/verify', async (req, res) => {
  const { username, code } = req.body;
  if (!username || !code) {
    return res.status(400).json({ success: false, error: 'Faltan datos de verificación.' });
  }
  const result = await DatabaseManager.verifyEmail(username, code);
  res.json(result);
});

// Middleware for JWT protected HTTP routes
const authenticateHTTP = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ success: false, error: 'No token provided' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

app.post('/api/profile/update', authenticateHTTP, async (req, res) => {
  const { firstName, lastName, newEmail } = req.body;
  const result = await DatabaseManager.updateProfile(req.user.id || req.user.username, firstName, lastName, newEmail);
  if (result.success && result.emailChanged && result.newCode) {
    sendVerificationPin(newEmail, result.newCode, req.user.username);
    delete result.newCode; // Hide from client
  }
  res.json(result);
});

// Serve static frontend build
app.use(express.static(join(__dirname, '../dist')));

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Autenticación denegada: Token no provisto.'));
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded; // { id, username }
    next();
  } catch (err) {
    return next(new Error('Autenticación denegada: Token inválido.'));
  }
});

io.on('connection', (socket) => {
  console.log(`[Socket] Conectado: ${socket.id} (${socket.user.username})`);

  // Check if player is already in a room (Page reload scenario)
  const activeRoom = roomManager.reconnectPlayer(socket.id, socket.user.username);
  if (activeRoom) {
    socket.join(activeRoom.code);
    console.log(`[Auto-Reconexión] ${socket.user.username} regresado a la sala ${activeRoom.code}`);
    socket.emit('reconnected_to_room', { room: activeRoom, inGame: activeRoom.inGame });
    io.to(activeRoom.code).emit('room_updated', activeRoom);
  }

  // Create Room
  socket.on('create_room', async ({ level = 1 }, callback) => {
    const playerName = socket.user.username; // Use secure token username
    const result = roomManager.createRoom(socket.id, playerName);
    
    // If room already existed (reconnect), it returns { room, reconnected: true }
    const room = result.room || result;
    
    // SECURE: Fetch true level from database! Do not trust the client payload!
    const trueLevel = await DatabaseManager.getUserData(playerName);
    room.currentLevel = trueLevel;
    
    socket.join(room.code);
    
    if (result.reconnected) {
      console.log(`[Reconexión a Sala] Código: ${room.code} por ${playerName} (Nivel ${room.currentLevel})`);
    } else {
      console.log(`[Sala Creada] Código: ${room.code} por ${playerName} (Nivel ${room.currentLevel})`);
    }
    
    // Broadcast updated public rooms to all connected clients
    io.emit('public_rooms_updated', roomManager.getPublicRooms());
    
    callback({ success: true, room });
  });

  // Get Public Rooms
  socket.on('get_public_rooms', (callback) => {
    callback(roomManager.getPublicRooms());
  });

  // Join Room
  socket.on('join_room', ({ roomCode }, callback) => {
    const playerName = socket.user.username;
    const result = roomManager.joinRoom(roomCode, socket.id, playerName);
    if (result.error) {
      return callback({ success: false, error: result.error });
    }

    socket.join(result.room.code);
    io.to(result.room.code).emit('room_updated', result.room);
    console.log(`[Jugador Unido] ${playerName} a sala ${result.room.code}`);
    
    io.emit('public_rooms_updated', roomManager.getPublicRooms());
    
    callback({ success: true, room: result.room, player: result.player });
  });

  // Start Game
  socket.on('start_game', ({ roomCode }) => {
    const room = roomManager.getRoom(roomCode);
    if (room && room.hostId === socket.id) {
      room.inGame = true;
      io.to(room.code).emit('game_started', { level: room.currentLevel, playersCount: room.players.length });
      io.emit('public_rooms_updated', roomManager.getPublicRooms());
    }
  });

  // Player Position Movement Broadcast
  socket.on('player_move', ({ roomCode, position, rotationY, health }) => {
    socket.to(roomCode).emit('player_moved', {
      id: socket.id,
      position,
      rotationY,
      health
    });
  });

  // Ghost Enemy Position Broadcast (sent by Host)
  socket.on('ghost_move', ({ roomCode, position }) => {
    socket.to(roomCode).emit('ghost_moved', { position });
  });

  // Player Damaged by Ghost
  socket.on('player_damaged', ({ roomCode, playerId, health }) => {
    io.to(roomCode).emit('update_player_health', { playerId, health });
  });

  // Next Level Trigger & Save Progress
  socket.on('level_complete', async ({ roomCode, username }) => {
    const room = roomManager.getRoom(roomCode);
    if (room) {
      room.currentLevel += 1;
      
      // Save database progress for players in Nube
      if (username) {
        const updatedStats = await DatabaseManager.saveProgress(username, room.currentLevel);
        if (updatedStats) {
          socket.emit('user_progress_updated', updatedStats);
        }
      }
      for (const p of room.players) {
        if (p.name) {
          const stats = await DatabaseManager.saveProgress(p.name, room.currentLevel);
          if (stats && p.id === socket.id) {
            socket.emit('user_progress_updated', stats);
          }
        }
      }

      io.to(room.code).emit('load_next_level', { 
        level: room.currentLevel,
        playersCount: room.players.length
      });
    }
  });

  // Leave Room explicitly
  socket.on('leave_room', () => {
    const affectedRoom = roomManager.removePlayer(socket.id);
    if (affectedRoom) {
      socket.leave(affectedRoom.code);
      io.to(affectedRoom.code).emit('room_updated', affectedRoom);
      console.log(`[Sala Abandonada] Socket ${socket.id} de la sala ${affectedRoom.code}`);
    }
    io.emit('public_rooms_updated', roomManager.getPublicRooms());
  });

  // Disconnect
  socket.on('disconnect', () => {
    const affectedRoom = roomManager.removePlayer(socket.id);
    if (affectedRoom) {
      io.to(affectedRoom.code).emit('room_updated', affectedRoom);
    }
    io.emit('public_rooms_updated', roomManager.getPublicRooms());
    console.log(`[Socket] Desconectado: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`⚡ Servidor Multijugador en la Nube Triad Vaults ejecutándose en http://localhost:${PORT}`);
});
