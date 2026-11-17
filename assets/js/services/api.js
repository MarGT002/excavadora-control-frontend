import { CONFIG, route } from '../config.js';
import { request, ApiError } from './http.js';
import { isObj, asArray, toInt, toText } from '../utils/validate.js';

/**
 * Cliente REST de la API del vehículo. Valida y normaliza cada respuesta
 * (los datos remotos se tratan como no confiables).
 */

function normCommand(c) {
  if (!isObj(c)) return null;
  const id = toInt(c.id_comando);
  const nombre = toText(c.nombre, 60);
  if (id === null || !nombre) return null;
  return { id, nombre: nombre.toUpperCase(), codigo: toInt(c.codigo), descripcion: toText(c.descripcion, 255), activo: Boolean(c.activo) };
}

function normHistItem(h) {
  if (!isObj(h)) return null;
  const id = toInt(h.id_historial);
  const comando = toText(h.comando, 60);
  if (id === null || !comando) return null;
  if (toInt(h.id_vehiculo) !== null && toInt(h.id_vehiculo) !== CONFIG.VEHICLE_ID) return null;
  return { id, comando, codigo: toInt(h.codigo), fecha: toText(h.fecha_hora, 40), origen: toText(h.origen, 30) };
}

export const Api = {
  async vehiculo(signal) {
    const d = await request(route('VEHICULO'), { signal });
    const v = isObj(d.vehiculo) ? d.vehiculo : {};
    return { id: toInt(v.id_vehiculo) ?? CONFIG.VEHICLE_ID, nombre: toText(v.nombre, 80) || `Vehículo ${CONFIG.VEHICLE_ID}`, modelo: toText(v.modelo, 80) };
  },

  async comandos() {
    const d = await request(route('COMANDOS'));
    return asArray(d).map(normCommand).filter(Boolean);
  },

  async demos() {
    const d = await request(route('DEMOS'));
    return asArray(d).map((x) => (isObj(x) && toInt(x.id_demo) !== null
      ? { id: toInt(x.id_demo), nombre: toText(x.nombre, 80) || `DEMO ${x.id_demo}`, descripcion: toText(x.descripcion, 255), activo: Boolean(x.activo) }
      : null)).filter(Boolean);
  },

  async estado(signal) {
    const d = await request(route('ESTADO'), { signal });
    if (!isObj(d)) throw new ApiError('Respuesta de estado no válida', { kind: 'invalid' });
    return { comando: toText(d.comando, 60), codigo: toInt(d.codigo), vehiculo: toText(d.vehiculo, 80), fecha: toText(d.fecha_actualizacion, 40) };
  },

  async historial(signal) {
    const d = await request(route('HISTORIAL'), { signal });
    if (!isObj(d) || !Array.isArray(d.movimientos)) throw new ApiError('Historial no válido', { kind: 'invalid' });
    const seen = new Set();
    return d.movimientos.map(normHistItem).filter((h) => h && !seen.has(h.id) && seen.add(h.id))
      .sort((a, b) => b.id - a.id)                     // id_historial autoincremental: más reciente primero
      .slice(0, CONFIG.HISTORY_LIMIT);
  },

  movimiento(idComando) {
    return request(route('MOVIMIENTO'), { method: 'POST', body: { id_comando: Number(idComando), origen: CONFIG.ORIGEN } });
  },

  iniciarDemo(idDemo) {
    return request(route('DEMO_INICIAR', { demo: idDemo }), { method: 'POST' });
  },

  cancelarDemo() {
    return request(route('DEMO_CANCELAR'), { method: 'POST' });
  },

  /** true = salud OK. Lanza ApiError si no responde. */
  async healthApi() {
    const d = await request(route('HEALTH_API'), { timeout: 5000 });
    return d?.status === 'ok';
  },

  /** 'ok' | 'down' | 'unverified' (no existe el diagnóstico en el backend) */
  async healthDb() {
    try {
      const d = await request(route('HEALTH_DB'), { timeout: 8000 });
      return d?.status === 'ok' ? 'ok' : 'down';
    } catch (e) {
      if (e.status === 503) return 'down';
      if (e.status === 404 || e.status === 405) return 'unverified';
      throw e;
    }
  }
};
