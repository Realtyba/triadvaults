#!/usr/bin/env node
/**
 * Genera `build/icon.png`, el icono que empaqueta electron-builder.
 *
 * Se dibuja por código en lugar de guardar un binario en el repositorio: así el
 * icono se puede leer, discutir y cambiar de color en una línea, y no hay ningún
 * fichero opaco del que nadie sepa de dónde salió. electron-builder deriva de este
 * PNG el `.ico` de Windows y el resto de tamaños.
 *
 * Sin dependencias: el PNG se escribe a mano (cabecera, datos comprimidos con zlib
 * y CRC de cada trozo), que para una imagen plana son treinta líneas.
 *
 * Uso: node scripts/make-icon.js
 */
import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIZE = 512;
const SS = 2; // supermuestreo: el triángulo en diagonal sin esto queda con dientes

const BG = [6, 8, 18];
const CYAN = [0, 243, 255];
const MAGENTA = [255, 0, 128];

/** Distancia con signo de un punto al segmento AB. Negativa da igual: se usa |d|. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function mix(a, b, amount) {
  const k = Math.max(0, Math.min(1, amount));
  return [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * k));
}

/** El emblema: un triángulo —los tres agentes— con un vértice marcado. */
function shade(x, y) {
  const cx = SIZE / 2;
  const cy = SIZE / 2 + SIZE * 0.03;
  const radius = SIZE * 0.33;

  const vertices = [0, 1, 2].map(i => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  });

  let edge = Infinity;
  for (let i = 0; i < 3; i++) {
    const [ax, ay] = vertices[i];
    const [bx, by] = vertices[(i + 1) % 3];
    edge = Math.min(edge, distanceToSegment(x, y, ax, ay, bx, by));
  }

  const stroke = SIZE * 0.018;
  let color = [...BG];

  // Resplandor primero, trazo encima: al revés el halo taparía la línea.
  color = mix(color, CYAN, Math.max(0, 1 - edge / (stroke * 6)) * 0.22);
  color = mix(color, CYAN, Math.max(0, 1 - Math.max(0, edge - stroke) / 2));

  vertices.forEach(([vx, vy], index) => {
    const d = Math.hypot(x - vx, y - vy);
    const node = SIZE * 0.032;
    const tint = index === 0 ? MAGENTA : CYAN;
    color = mix(color, tint, Math.max(0, 1 - d / (node * 3.5)) * 0.3);
    color = mix(color, tint, Math.max(0, 1 - Math.max(0, d - node) / 2));
  });

  return color;
}

function renderPixels() {
  // Una fila = 1 byte de filtro + SIZE píxeles RGBA.
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));

  for (let y = 0; y < SIZE; y++) {
    const rowStart = y * (1 + SIZE * 4);
    raw[rowStart] = 0; // filtro "None"

    for (let x = 0; x < SIZE; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const sample = shade(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
          acc[0] += sample[0];
          acc[1] += sample[1];
          acc[2] += sample[2];
        }
      }

      const offset = rowStart + 1 + x * 4;
      const samples = SS * SS;
      raw[offset] = Math.round(acc[0] / samples);
      raw[offset + 1] = Math.round(acc[1] / samples);
      raw[offset + 2] = Math.round(acc[2] / samples);
      raw[offset + 3] = 255;
    }
  }

  return raw;
}

// ------------------------------------------------------------------ el fichero

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // 8 bits por canal
ihdr[9] = 6; // RGBA
// bytes 10-12: compresión, filtro e entrelazado, todos en su único valor válido (0)

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(renderPixels(), { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const outDir = join(__dirname, '../build');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'icon.png'), png);

console.log(`✓ build/icon.png — ${SIZE}×${SIZE}, ${(png.length / 1024).toFixed(1)} kB`);
