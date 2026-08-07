/**
 * Iconografía en SVG.
 *
 * Antes los iconos eran emoji incrustados en los textos traducidos. Eso tenía dos
 * problemas: en Linux sin fuente de emoji varios salían como cuadros vacíos (📜 y
 * ❓ lo hacían), y los que sí salían llegaban con el estilo de otro sistema, que
 * nunca casa con el resto de la interfaz. Aquí son trazos que heredan
 * `currentColor` y el tamaño del contexto, así que siempre encajan.
 *
 * Trazo y no relleno a propósito: acompaña a la tipografía fina del tema.
 */

const ICONS = {
  audioOn: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a9 9 0 0 1 0 12"/>',
  audioOff: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6"/><path d="M22 9l-5 6"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.2 9.3a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.4-2.8 4"/><path d="M12 17.2h.01"/>',
  bolt: '<path d="M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z"/>',
  hint: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.5.4.8 1 .9 1.6h5.2c.1-.6.4-1.2.9-1.6A6 6 0 0 0 12 3z"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 6H4v1a3 3 0 0 0 3 3"/><path d="M17 6h3v1a3 3 0 0 1-3 3"/><path d="M9 20h6"/><path d="M12 14v6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  shield: '<path d="M12 3l7 3v6c0 4.2-2.9 8-7 9-4.1-1-7-4.8-7-9V6l7-3z"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h1"/><path d="M9 10h1"/><path d="M12 10h1"/><path d="M15 10h1"/><path d="M18 10h0"/><path d="M8 14h8"/>',
  gamepad: '<rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/><path d="M9 10v4"/><path d="M7 12h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  server: '<rect x="4" y="3" width="16" height="6" rx="1"/><rect x="4" y="13" width="16" height="6" rx="1"/><path d="M4 9h16v4H4z"/><circle cx="8" cy="6" r=".5"/><circle cx="8" cy="16" r=".5"/>',
  heart: '<path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0L12 5.36l-.77-.78a5.4 5.4 0 0 0-7.65 7.65l.78.77L12 20.64l7.64-7.64.78-.77a5.4 5.4 0 0 0 0-7.65z"/>',
  ghost: '<path d="M12 2a8 8 0 0 0-8 8v7l2-2 2 2 2-2 2 2 2-2 2 2 2-2v-7a8 8 0 0 0-8-8z"/><circle cx="9" cy="10" r="1.5" fill="currentColor"/><circle cx="15" cy="10" r="1.5" fill="currentColor"/>',
  zap: '<path d="M4 14l8-12v8h8l-8 12v-8z"/>',
  puzzle: '<path d="M12 2l3 3h4v4l3 3-3 3v4h-4l-3 3-3-3H5v-4l-3-3 3-3V5h4z"/>',
  touch: '<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M12 11V9.5a1.5 1.5 0 0 1 3 0V11"/><path d="M15 11v-.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5.2-3l-2-3.5a1.5 1.5 0 0 1 2.6-1.5L9 15"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/>'
};

/**
 * @param {keyof ICONS} name
 * @param {object} [options]
 * @param {number} [options.size]  lado en píxeles
 * @param {string} [options.className]
 * @returns {string} SVG listo para interpolar en una plantilla
 */
export function icon(name, { size = 16, className = '' } = {}) {
  const body = ICONS[name];
  if (!body) return '';

  return `<svg class="icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}
