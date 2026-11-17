import { CONFIG } from '../config.js';

/** Nombres legibles para los comandos del catálogo (la clave real sigue siendo el nombre de la API). */
const LABELS = {
  AVANZAR: 'Avanzar', RETROCEDER: 'Retroceder', GIRAR_IZQUIERDA: 'Girar izquierda', GIRAR_DERECHA: 'Girar derecha',
  SUBIR_BRAZO: 'Subir brazo', BAJAR_BRAZO: 'Bajar brazo', ABRIR_PALA: 'Abrir pala', CERRAR_PALA: 'Cerrar pala',
  DETENER: 'Detener', ENCENDER: 'Encender / apagar', LUCES: 'Luces', BOCINA: 'Bocina', DEMO: 'Demo integrada'
};

const ICONS = {
  AVANZAR: 'bi-arrow-up', RETROCEDER: 'bi-arrow-down', GIRAR_IZQUIERDA: 'bi-arrow-left', GIRAR_DERECHA: 'bi-arrow-right',
  SUBIR_BRAZO: 'bi-chevron-double-up', BAJAR_BRAZO: 'bi-chevron-double-down', ABRIR_PALA: 'bi-arrows-angle-expand',
  CERRAR_PALA: 'bi-arrows-angle-contract', DETENER: 'bi-octagon-fill', ENCENDER: 'bi-power', LUCES: 'bi-lightbulb-fill',
  BOCINA: 'bi-megaphone-fill', DEMO: 'bi-stars'
};

export const commandLabel = (name) => LABELS[String(name).toUpperCase()] ?? String(name || '—');
export const commandIcon = (name) => ICONS[String(name).toUpperCase()] ?? 'bi-joystick';

/**
 * Interpreta una fecha del backend. Las de RDS vienen sin zona (se aplica DB_TIME_OFFSET);
 * las del WebSocket traen zona ISO. Devuelve null si no es válida (nunca se fabrica una fecha).
 */
export function parseDate(value) {
  if (!value || typeof value !== 'string') return null;
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  const d = new Date(hasZone ? value : `${value}${CONFIG.DB_TIME_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const fmtDate = new Intl.DateTimeFormat('es-MX', { timeZone: CONFIG.DISPLAY_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtTime = new Intl.DateTimeFormat('es-MX', { timeZone: CONFIG.DISPLAY_TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export const formatDate = (d) => (d ? fmtDate.format(d) : '—');
export const formatTime = (d) => (d ? fmtTime.format(d) : '—');

export function relativeTime(d, now = Date.now()) {
  if (!d) return '';
  const s = Math.round((now - d.getTime()) / 1000);
  if (s < 5) return 'justo ahora';
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}
