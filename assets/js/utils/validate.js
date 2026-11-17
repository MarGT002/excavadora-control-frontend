/** Utilidades de validación para datos remotos (REST/WSS) no confiables. */

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export const asArray = (v) => (Array.isArray(v) ? v : []);

export function toInt(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return Number.isInteger(n) ? n : null;
}

/** Convierte a texto plano recortado; nunca se usa como HTML. */
export function toText(v, max = 120) {
  if (v === null || v === undefined) return '';
  return String(v).slice(0, max);
}
