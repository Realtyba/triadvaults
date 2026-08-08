import { clamp } from '../utils/math.js';

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

/**
 * Escapa texto antes de interpolarlo en una plantilla.
 * Nombres, usuarios y correos los escribe el propio jugador y acaban en el lobby,
 * en el ranking y en la lista de salas; sin esto son HTML inyectable.
 */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, char => ESCAPE_MAP[char]);
}

/** Crea un elemento con clase e id opcionales. */
export function el(tag, { id, className, html } = {}) {
  const node = document.createElement(tag);
  if (id) node.id = id;
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

export function setText(node, value) {
  if (node && node.textContent !== String(value)) node.textContent = String(value);
}

export function setWidth(node, percent) {
  if (node) node.style.width = `${clamp(percent, 0, 100)}%`;
}

export function toggleClass(node, className, on) {
  if (node) node.classList.toggle(className, !!on);
}

export function show(node, visible) {
  toggleClass(node, 'hidden', !visible);
}

/**
 * Los dos formatos de tiempo del juego. **No se unifican, y es deliberado.**
 *
 * `formatDuration` es para listas y perfiles, donde el número se lee de un vistazo entre
 * texto y "12m 30s" se entiende sin contexto. `formatClock` es para el cronómetro del
 * HUD, donde importa que la anchura no cambie al pasar de 9 a 10 segundos: relleno con
 * ceros y ancho fijo. Son dos requisitos distintos, no una duplicación.
 */
export function formatDuration(seconds = 0) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

/** Segundos como `MM:SS`, de anchura constante. Ver `formatDuration`. */
export function formatClock(seconds = 0) {
  const total = Math.max(0, Math.floor(seconds));
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * Un color de Three.js (`0x00f3ff`) como cadena CSS (`#00f3ff`).
 *
 * Estaba escrita tres veces: en `GameApp`, en `UIManager` y dentro de `PlayerCard`. Vive
 * aquí y no en `engine/` porque el destino siempre es CSS: la escena usa los números tal
 * cual, y el único motivo de convertirlos es que algo se pinte con DOM.
 */
export function hexColor(value) {
  return `#${Number(value).toString(16).padStart(6, '0')}`;
}
