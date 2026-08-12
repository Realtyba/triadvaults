/**
 * Registro de incidencias del servidor de salas.
 *
 * Este proceso no tiene base de datos ni servicio de logging externo: solo
 * `console.error`. Este buffer en memoria da visibilidad operativa mínima —los
 * últimos N eventos relevantes— sin persistir nada en disco, en línea con el resto
 * del servidor ("las salas son efímeras y no sobreviven a un reinicio").
 */

const MAX_INCIDENTS = 200;

/** @type {{at: string, type: string, detail: string}[]} */
const incidents = [];

export function recordIncident(type, detail) {
  incidents.push({ at: new Date().toISOString(), type, detail: String(detail) });
  if (incidents.length > MAX_INCIDENTS) incidents.shift();
}

/** Más reciente primero. */
export function getIncidents() {
  return [...incidents].reverse();
}
