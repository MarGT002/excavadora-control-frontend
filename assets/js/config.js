/**
 * Configuración pública del frontend (CONTROL + MONITOREO + ADMINISTRACIÓN).
 * Solo datos públicos: NUNCA colocar aquí API keys, tokens ni credenciales de AWS/RDS.
 * Las rutas corresponden al Swagger real de la API (https://appt1.deguel.site/docs).
 */
const API_HOST = 'appt1.deguel.site';

export const CONFIG = Object.freeze({
  API_BASE_URL: `https://${API_HOST}`,
  WS_BASE_URL: `wss://${API_HOST}`,

  // Contratos reales de la API (FastAPI). {id} = id_vehiculo de la unidad activa, {demo} = id_demo, {u} = id_usuario
  ENDPOINTS: Object.freeze({
    // --- 4.1 / 4.2 (ahora requieren sesión y permiso sobre la unidad)
    VEHICULO: '/vehiculos/{id}',
    COMANDOS: '/vehiculos/{id}/comandos',
    MOVIMIENTO: '/vehiculos/{id}/movimientos',
    ESTADO: '/vehiculos/{id}/estado',
    HISTORIAL: '/vehiculos/{id}/historial',
    DEMOS: '/vehiculos/{id}/demos',
    DEMO_INICIAR: '/vehiculos/{id}/demos/{demo}/iniciar',
    DEMO_CANCELAR: '/vehiculos/{id}/demos/cancelar',
    HEALTH_API: '/health',
    HEALTH_DB: '/health/db',
    WS_VEHICULO: '/ws/vehiculos/{id}',
    // --- 4.3 · sesión
    LOGIN: '/auth/login',
    INVITADO: '/auth/invitado',
    ME: '/auth/me',
    LOGOUT: '/auth/logout',
    REGISTRO: '/auth/registro',
    VERIFICAR: '/auth/verificar',
    REENVIAR: '/auth/reenviar-codigo',
    // --- 4.3 · público
    CATALOGO: '/catalogo/modelos',
    EXHIBICION: '/catalogo/exhibicion',
    // --- 4.3 · comprador
    MIS_VEHICULOS: '/mis-vehiculos',
    SOPORTE: '/mis-vehiculos/{id}/soporte',
    // --- 4.3 · invitado
    RESERVA: '/invitado/reserva',
    // --- 4.3 · demos (editor)
    DEMO: '/demos/{demo}',
    DEMO_PASOS: '/demos/{demo}/pasos',
    DEMO_ACTUALIZAR: '/demos/{demo}/actualizar',
    DEMO_ELIMINAR: '/demos/{demo}/eliminar',
    // --- 4.3 · administración
    DASHBOARD: '/admin/dashboard',
    MODELOS: '/admin/modelos',
    MODELO: '/admin/modelos/{m}',
    UNIDADES: '/admin/unidades',
    UNIDAD: '/admin/unidades/{id}',
    ASIGNAR: '/admin/unidades/{id}/asignar',
    LIBERAR: '/admin/unidades/{id}/liberar',
    CLAVE_DISPOSITIVO: '/admin/unidades/{id}/clave-dispositivo',
    TRANSFERIR_DISPOSITIVO: '/admin/unidades/{id}/dispositivo/transferir',
    CLIENTES: '/admin/clientes',
    CLIENTE: '/admin/clientes/{u}',
    AUDITORIA: '/admin/auditoria'
  }),

  // Nombres EXACTOS del catálogo (tabla comandos). Los id_comando se leen de la API, no se inventan.
  COMMANDS: Object.freeze({
    FORWARD: 'AVANZAR',
    BACKWARD: 'RETROCEDER',
    LEFT: 'GIRAR_IZQUIERDA',
    RIGHT: 'GIRAR_DERECHA',
    ARM_UP: 'SUBIR_BRAZO',
    ARM_DOWN: 'BAJAR_BRAZO',
    BUCKET_OPEN: 'ABRIR_PALA',
    BUCKET_CLOSE: 'CERRAR_PALA',
    STOP: 'DETENER',
    POWER: 'ENCENDER',
    LIGHTS: 'LUCES',
    HORN: 'BOCINA',
    BUILTIN_DEMO: 'DEMO'
  }),

  ORIGEN: 'WEB_CONTROL',          // campo "origen" del POST de movimiento (máx. 30 caracteres)
  // Palanca sostenida: reenvía la dirección activa cada N ms (el ESP8266 mantiene cada orden ~1000 ms),
  // así el movimiento es continuo hasta soltar o cambiar de dirección, como un control de consola.
  HOLD_REPEAT_MS: 600,
  TIMEOUT_MS: 8000,
  HEALTH_INTERVAL_MS: 20000,      // verificación moderada de API/RDS
  HISTORY_LIMIT: 10,
  RESYNC_DEBOUNCE_MS: 350,        // agrupa eventos WSS antes de reconsultar el historial
  WS_RETRY_BASE_MS: 1500,
  WS_RETRY_MAX_MS: 20000,
  GAMEPAD_DEADZONE: 0.5,          // inclinación mínima de un stick del control para contar como dirección

  // Las fechas de RDS llegan sin zona ("2026-11-06T18:07:41"). La instancia RDS trabaja en UTC;
  // si tu RDS usa otra zona cambia este valor (p. ej. '-06:00').
  DB_TIME_OFFSET: 'Z',
  DISPLAY_TIME_ZONE: 'America/Mexico_City'
});

/** Unidad activa (la fija core/vehicle.js). Se usa para completar {id} en las rutas. */
export const active = { vehicleId: null };

/** Sustituye {id}, {demo}, {m} y {u} en una ruta con valores codificados. */
export function route(name, params = {}) {
  const path = CONFIG.ENDPOINTS[name];
  if (!path) throw new Error(`Ruta no configurada: ${name}`);
  const id = params.id ?? active.vehicleId;
  if (path.includes('{id}') && (id === null || id === undefined)) throw new Error('No hay una unidad seleccionada');
  return path
    .replace('{id}', encodeURIComponent(id))
    .replace('{demo}', encodeURIComponent(params.demo ?? ''))
    .replace('{m}', encodeURIComponent(params.m ?? ''))
    .replace('{u}', encodeURIComponent(params.u ?? ''));
}
