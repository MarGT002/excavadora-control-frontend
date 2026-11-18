import { active, route } from '../config.js';
import { request, ApiError } from './http.js';
import { isObj, asArray, toInt, toText } from '../utils/validate.js';

/**
 * Cliente REST de la API. Valida y normaliza cada respuesta (los datos remotos se tratan como no confiables).
 * Todas las rutas de vehículo usan la unidad activa; el permiso real lo decide el backend.
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
  if (toInt(h.id_vehiculo) !== null && toInt(h.id_vehiculo) !== active.vehicleId) return null;
  return { id, comando, codigo: toInt(h.codigo), fecha: toText(h.fecha_hora, 40), origen: toText(h.origen, 30) };
}

function normUnidad(u) {
  if (!isObj(u) || toInt(u.id_vehiculo) === null) return null;
  return {
    id: toInt(u.id_vehiculo), nombre: toText(u.nombre, 80), codigo: toText(u.codigo_unidad, 40) || `#${u.id_vehiculo}`,
    estado: toText(u.estado_comercial, 20), modelo: toText(u.modelo_nombre, 80), idModelo: toInt(u.id_modelo),
    propietario: toText(u.propietario_nombre, 100), propietarioEmail: toText(u.propietario_email, 120), idPropietario: toInt(u.id_propietario),
    activo: Boolean(u.activo), dispositivo: Boolean(u.dispositivo_en_linea), tieneClave: Boolean(u.tiene_clave_dispositivo),
    soporte: isObj(u.soporte) ? { activo: Boolean(u.soporte.activo), segundos: toInt(u.soporte.segundos_restantes) ?? 0 } : null
  };
}

function normDemo(d) {
  if (!isObj(d) || toInt(d.id_demo) === null) return null;
  return { id: toInt(d.id_demo), nombre: toText(d.nombre, 80) || `DEMO ${d.id_demo}`, descripcion: toText(d.descripcion, 255),
    activo: Boolean(d.activo), tipo: toText(d.tipo, 10) || 'FABRICA', idVehiculo: toInt(d.id_vehiculo) };
}

const json = (method, body) => ({ method, body });

export const Api = {
  // ------------------------------------------------------------ sesión
  login: (email, password) => request(route('LOGIN'), { ...json('POST', { email, password }), auth: false }),
  invitado: () => request(route('INVITADO'), { method: 'POST', auth: false }),
  me: () => request(route('ME')),
  logout: () => request(route('LOGOUT'), { method: 'POST', timeout: 4000 }),

  // ------------------------------------------------------------ público
  async catalogo() { return asArray(await request(route('CATALOGO'), { auth: false })); },
  async exhibicion() { return asArray(await request(route('EXHIBICION'), { auth: false })); },

  // ------------------------------------------------------------ unidad activa (4.1 / 4.2)
  async vehiculo(signal) {
    const d = await request(route('VEHICULO'), { signal });
    const v = isObj(d.vehiculo) ? d.vehiculo : {};
    const u = isObj(d.unidad) ? d.unidad : {};
    return {
      id: toInt(v.id_vehiculo) ?? active.vehicleId, nombre: toText(v.nombre, 80) || `Vehículo ${active.vehicleId}`, modelo: toText(u.modelo_nombre, 80),
      codigo: toText(u.codigo_unidad, 40), estado: toText(u.estado_comercial, 20), dispositivo: Boolean(d.dispositivo_en_linea)
    };
  },

  async comandos() {
    const d = await request(route('COMANDOS'));
    return asArray(d).map(normCommand).filter(Boolean);
  },

  async demos(id) {
    const d = await request(route('DEMOS', { id }));
    return asArray(d).map(normDemo).filter(Boolean);
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
      .slice(0, 10);
  },

  movimiento(idComando, origen) {
    return request(route('MOVIMIENTO'), json('POST', { id_comando: Number(idComando), origen }));
  },

  iniciarDemo(idDemo) { return request(route('DEMO_INICIAR', { demo: idDemo }), { method: 'POST' }); },
  cancelarDemo() { return request(route('DEMO_CANCELAR'), { method: 'POST' }); },

  async healthApi() {
    const d = await request(route('HEALTH_API'), { timeout: 5000, auth: false });
    return d?.status === 'ok';
  },

  /** 'ok' | 'down' | 'unverified' (no existe el diagnóstico en el backend) */
  async healthDb() {
    try {
      const d = await request(route('HEALTH_DB'), { timeout: 8000, auth: false });
      return d?.status === 'ok' ? 'ok' : 'down';
    } catch (e) {
      if (e.status === 503) return 'down';
      if (e.status === 404 || e.status === 405) return 'unverified';
      throw e;
    }
  },

  // ------------------------------------------------------------ comprador
  async misVehiculos() { return asArray(await request(route('MIS_VEHICULOS'))).map(normUnidad).filter(Boolean); },
  otorgarSoporte: (id, minutos, motivo) => request(route('SOPORTE', { id }), json('POST', { minutos, motivo })),
  revocarSoporte: (id) => request(route('SOPORTE', { id }), { method: 'DELETE' }),

  // ------------------------------------------------------------ invitado
  reservar: (id) => request(route('RESERVA'), json('POST', { id_vehiculo: Number(id) })),
  reserva: () => request(route('RESERVA')),
  terminarReserva: () => request(route('RESERVA'), { method: 'DELETE' }),

  // ------------------------------------------------------------ demos (editor)
  async demo(id) {
    const d = await request(route('DEMO', { demo: id }));
    return { ...normDemo(d), pasos: asArray(d.pasos).map((p) => ({ idComando: toInt(p.id_comando), comando: toText(p.comando, 60),
      duracion: toInt(p.duracion_ms) ?? 0, pausa: toInt(p.pausa_ms) ?? 0 })) };
  },
  crearDemo: (idVehiculo, nombre, descripcion) => request(route('DEMOS', { id: idVehiculo }), json('POST', { nombre, descripcion })),
  actualizarDemo: (id, nombre, descripcion, activo) => request(route('DEMO_ACTUALIZAR', { demo: id }), json('POST', { nombre, descripcion, activo })),
  eliminarDemo: (id) => request(route('DEMO_ELIMINAR', { demo: id }), { method: 'POST' }),
  guardarPasos: (id, pasos) => request(route('DEMO_PASOS', { demo: id }), json('PUT', {
    pasos: pasos.map((p) => ({ id_comando: p.idComando, duracion_ms: p.duracion, pausa_ms: p.pausa })) })),
  async comandosDe(id) { return asArray(await request(route('COMANDOS', { id }))).map(normCommand).filter(Boolean); },

  // ------------------------------------------------------------ administración
  dashboard: () => request(route('DASHBOARD')),
  async unidades(filtros = {}) {
    const qs = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v)).toString();
    return asArray(await request(route('UNIDADES') + (qs ? `?${qs}` : ''))).map(normUnidad).filter(Boolean);
  },
  crearUnidad: (d) => request(route('UNIDADES'), json('POST', d)),
  actualizarUnidad: (id, d) => request(route('UNIDAD', { id }), json('PATCH', d)),
  asignar: (id, idUsuario) => request(route('ASIGNAR', { id }), json('POST', { id_usuario: Number(idUsuario) })),
  liberar: (id, estado) => request(route('LIBERAR', { id }), json('POST', { estado })),
  claveDispositivo: (id) => request(route('CLAVE_DISPOSITIVO', { id }), { method: 'POST' }),
  modelos: async () => asArray(await request(route('MODELOS'))),
  crearModelo: (d) => request(route('MODELOS'), json('POST', d)),
  actualizarModelo: (m, d) => request(route('MODELO', { m }), json('PUT', d)),
  clientes: async (q) => asArray(await request(route('CLIENTES') + (q ? `?q=${encodeURIComponent(q)}` : ''))),
  crearCliente: (d) => request(route('CLIENTES'), json('POST', d)),
  actualizarCliente: (u, d) => request(route('CLIENTE', { u }), json('PATCH', d)),
  auditoria: (offset = 0, filtros = {}) => {
    const qs = new URLSearchParams({ limite: 25, offset, ...Object.fromEntries(Object.entries(filtros).filter(([, v]) => v)) });
    return request(`${route('AUDITORIA')}?${qs}`);
  }
};

export { normUnidad };
