import { CONFIG, active, route } from '../config.js';
import { bus, appState } from '../core/store.js';
import { isObj, toInt, toText } from '../utils/validate.js';

const KNOWN_TYPES = new Set(['estado', 'movimiento', 'demo_inicio', 'demo_movimiento', 'demo_fin', 'demo_cancelada', 'error',
  'dispositivo', 'acceso_revocado', 'reserva_fin']);

/** Cierres que NO se reintentan: el servidor negó el permiso o la sesión. */
const FATAL = { 4401: 'auth', 4403: 'revoked', 4404: 'revoked', 4408: 'reservation' };

/**
 * Sesión WSS REAL del navegador, única y compartida por CONTROL y MONITOREO, para la UNIDAD ACTIVA.
 * Se autentica con el token de sesión (wss:// cifra la URL) y el backend autoriza la unidad.
 * Al cambiar de unidad o cerrar sesión, la suscripción anterior se cierra antes de abrir otra.
 * Estados en bus 'ws:status': CONNECTING | ONLINE | RECONNECTING | OFFLINE | IDLE (sin unidad/sesión).
 * "ONLINE" = navegador ↔ servidor WSS; la presencia del ESP8266 llega aparte con el evento «dispositivo».
 */
class WsClient {
  #ws = null;
  #retry = 0;
  #timer = null;
  #everOpened = false;
  #token = null;
  #vehicleId = null;

  /** Abre (o reabre) la suscripción para la unidad activa. */
  start(token) {
    this.stop();
    this.#token = token;
    this.#vehicleId = active.vehicleId;
    this.#everOpened = false;
    this.#retry = 0;
    if (!token || this.#vehicleId === null) { this.#setStatus('IDLE'); return; }
    this.connect();
  }

  stop() {
    clearTimeout(this.#timer);
    const ws = this.#ws;
    this.#ws = null;
    if (ws) { try { ws.close(1000, 'Cambio de unidad o cierre de sesión'); } catch { /* ya cerrado */ } }
    this.#setStatus('IDLE');
  }

  connect() {
    clearTimeout(this.#timer);
    if (!this.#token || this.#vehicleId === null) return;
    if (this.#ws && (this.#ws.readyState === WebSocket.OPEN || this.#ws.readyState === WebSocket.CONNECTING)) return;
    this.#setStatus(this.#everOpened ? 'RECONNECTING' : 'CONNECTING');

    let ws;
    try {
      const url = `${CONFIG.WS_BASE_URL}${route('WS_VEHICULO', { id: this.#vehicleId })}?token=${encodeURIComponent(this.#token)}`;
      ws = new WebSocket(url);
    } catch { this.#scheduleRetry(); return; }
    this.#ws = ws;

    ws.addEventListener('open', () => {
      if (ws !== this.#ws) return;
      const isReconnect = this.#everOpened;
      this.#everOpened = true;
      this.#retry = 0;
      this.#setStatus('ONLINE');
      if (isReconnect) bus.emit('ws:reconnected');     // MONITOREO resincroniza por REST
    });

    ws.addEventListener('message', (ev) => {
      if (ws !== this.#ws) return;
      const msg = this.#parse(ev.data);
      if (msg) bus.emit('ws:message', msg);
    });

    ws.addEventListener('close', (ev) => {
      if (ws !== this.#ws) return;
      this.#ws = null;
      this.#setStatus('OFFLINE');
      const fatal = FATAL[ev.code];
      if (fatal) {
        bus.emit('ws:denied', { kind: fatal, code: ev.code, reason: ev.reason || '' });
        return;                                        // sin reintento: lo decide la app (login, otra unidad…)
      }
      this.#scheduleRetry();
    });
    // 'error' siempre va seguido de 'close'; el estado se gestiona allí.
  }

  /** Reintento inmediato (p. ej. al volver la red o al pulsar el indicador). */
  reconnectNow() {
    this.#retry = 0;
    if (!this.#ws) this.connect();
  }

  #scheduleRetry() {
    clearTimeout(this.#timer);
    this.#retry++;
    const base = Math.min(CONFIG.WS_RETRY_BASE_MS * 2 ** (this.#retry - 1), CONFIG.WS_RETRY_MAX_MS);
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));   // jitter
    this.#timer = setTimeout(() => this.connect(), delay);
  }

  #setStatus(s) {
    appState.wsStatus = s;
    bus.emit('ws:status', s);
  }

  /** Valida estructura y unidad; descarta mensajes ajenos o malformados. */
  #parse(raw) {
    let d;
    try { d = JSON.parse(raw); } catch { return null; }
    if (!isObj(d)) return null;
    const tipo = toText(d.tipo, 30);
    if (!KNOWN_TYPES.has(tipo)) return null;
    if (toInt(d.id_vehiculo) !== this.#vehicleId) return null;
    return {
      tipo,
      idVehiculo: this.#vehicleId,
      comando: toText(d.comando, 60),
      codigo: toInt(d.codigo),
      origen: toText(d.origen, 30),
      idDemo: toInt(d.id_demo),
      nombre: toText(d.nombre, 80),
      orden: toInt(d.orden),
      total: toInt(d.total_movimientos),
      duracionMs: toInt(d.duracion_ms),
      pausaMs: toInt(d.pausa_ms),
      detalle: toText(d.detalle, 160),
      motivo: toText(d.motivo, 120),
      conectado: typeof d.conectado === 'boolean' ? d.conectado : null,
      dispositivo: typeof d.dispositivo_en_linea === 'boolean' ? d.dispositivo_en_linea : null,
      timestamp: toText(d.timestamp, 40),
      raw: d
    };
  }
}

export const wsClient = new WsClient();

window.addEventListener('online', () => wsClient.reconnectNow());
