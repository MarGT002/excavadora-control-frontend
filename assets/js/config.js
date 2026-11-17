/**
 * Configuración pública del frontend (CONTROL + MONITOREO).
 * Solo datos públicos: NUNCA colocar aquí API keys, tokens ni credenciales de AWS/RDS.
 * Las rutas corresponden al Swagger real de la API desplegada (https://appt1.deguel.site/docs).
 */
const API_HOST = 'appt1.deguel.site';
const VEHICLE_ID = 1;

export const CONFIG = Object.freeze({
  VEHICLE_ID,
  API_BASE_URL: `https://${API_HOST}`,
  WS_URL: `wss://${API_HOST}/ws/vehiculos/${VEHICLE_ID}`,

  // Contratos reales de la API (FastAPI). {id} = id_vehiculo, {demo} = id_demo
  ENDPOINTS: Object.freeze({
    VEHICULO: '/vehiculos/{id}',                     // GET  detalle (vehiculo, comandos, estado, demos)
    COMANDOS: '/vehiculos/{id}/comandos',            // GET  catálogo
    MOVIMIENTO: '/vehiculos/{id}/movimientos',       // POST {id_comando, origen} -> 201
    ESTADO: '/vehiculos/{id}/estado',                // GET  último estado
    HISTORIAL: '/vehiculos/{id}/historial',          // GET  últimos 10 individuales
    DEMOS: '/vehiculos/{id}/demos',                  // GET  demos del vehículo
    DEMO_INICIAR: '/vehiculos/{id}/demos/{demo}/iniciar', // POST -> 202 (409 si ya corre una)
    DEMO_CANCELAR: '/vehiculos/{id}/demos/cancelar',     // POST -> 200 (404 si no hay demo)
    HEALTH_API: '/health',                           // GET  salud del proceso FastAPI
    HEALTH_DB: '/health/db'                          // GET  diagnóstico seguro de RDS (SELECT 1)
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

  ORIGEN: 'WEB_CONTROL',
  // Palanca sostenida: reenvía la dirección activa cada N ms (el ESP8266 mantiene cada orden ~1000 ms),
  // así el movimiento es continuo hasta soltar o cambiar de dirección, como un control de consola.
  HOLD_REPEAT_MS: 600,          // campo "origen" del POST de movimiento (máx. 30 caracteres)
  TIMEOUT_MS: 6000,
  HEALTH_INTERVAL_MS: 20000,      // verificación moderada de API/RDS
  HISTORY_LIMIT: 10,
  RESYNC_DEBOUNCE_MS: 350,        // agrupa eventos WSS antes de reconsultar el historial
  WS_RETRY_BASE_MS: 1500,
  WS_RETRY_MAX_MS: 20000,

  // Las fechas de RDS llegan sin zona ("2026-11-06T18:07:41"). La instancia RDS trabaja en UTC;
  // si tu RDS usa otra zona cambia este valor (p. ej. '-06:00').
  DB_TIME_OFFSET: 'Z',
  DISPLAY_TIME_ZONE: 'America/Mexico_City'
});

/** Sustituye {id} y {demo} en una ruta con valores codificados. */
export function route(name, params = {}) {
  const path = CONFIG.ENDPOINTS[name];
  if (!path) throw new Error(`Ruta no configurada: ${name}`);
  return path
    .replace('{id}', encodeURIComponent(params.id ?? CONFIG.VEHICLE_ID))
    .replace('{demo}', encodeURIComponent(params.demo ?? ''));
}
