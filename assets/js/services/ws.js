import { CONFIG } from '../config.js';
import { bus, appState } from '../core/store.js';
import { isObj, toInt, toText } from '../utils/validate.js';

const KNOWN_TYPES = new Set(['estado', 'movimiento', 'demo_inicio', 'demo_movimiento', 'demo_fin', 'demo_cancelada', 'error']);

/**
 * Sesión WSS REAL del navegador, única y compartida por CONTROL y MONITOREO.
 * Estados publicados en bus 'ws:status': CONNECTING | ONLINE | RECONNECTING | OFFLINE.
 * Importante: "ONLINE" = navegador ↔ servidor WSS; NO implica que el ESP8266 esté conectado.
 */
class WsClient {
  #ws = null;
  #retry = 0;
  #timer = null;
  #everOpened = false;

  connect() {
    clearTimeout(this.#timer);
    if (this.#ws && (this.#ws.readyState === WebSocket.OPEN || this.#ws.readyState === WebSocket.CONNECTING)) return;
    this.#setStatus(this.#everOpened ? 'RECONNECTING' : 'CONNECTING');

    let ws;
    try { ws = new WebSocket(CONFIG.WS_URL); }
    catch { this.#scheduleRetry(); return; }
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
      if (ev.code === 4404) console.warn('WSS: el vehículo no existe en el servidor (4404)');
      this.#scheduleRetry(ev.code === 4404 ? 4 : 1);
    });
    // 'error' siempre va seguido de 'close'; el estado se gestiona allí.
  }

  /** Reintento inmediato (p. ej. al volver la red o al pulsar el indicador). */
  reconnectNow() {
    this.#retry = 0;
    if (!this.#ws) this.connect();
  }

  #scheduleRetry(factor = 1) {
    clearTimeout(this.#timer);
    this.#retry++;
    const base = Math.min(CONFIG.WS_RETRY_BASE_MS * 2 ** (this.#retry - 1), CONFIG.WS_RETRY_MAX_MS) * factor;
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));   // jitter
    this.#timer = setTimeout(() => this.connect(), delay);
  }

  #setStatus(s) {
    appState.wsStatus = s;
    bus.emit('ws:status', s);
  }

  /** Valida estructura y vehículo; descarta mensajes ajenos o malformados. */
  #parse(raw) {
    let d;
    try { d = JSON.parse(raw); } catch { return null; }
    if (!isObj(d)) return null;
    const tipo = toText(d.tipo, 30);
    if (!KNOWN_TYPES.has(tipo)) return null;
    if (toInt(d.id_vehiculo) !== CONFIG.VEHICLE_ID) return null;
    return {
      tipo,
      idVehiculo: CONFIG.VEHICLE_ID,
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
      timestamp: toText(d.timestamp, 40),
      raw: d
    };
  }
}

export const wsClient = new WsClient();

window.addEventListener('online', () => wsClient.reconnectNow());
