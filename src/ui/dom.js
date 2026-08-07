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

/** Formatea segundos como `12m 30s`. */
export function formatDuration(seconds = 0) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}
