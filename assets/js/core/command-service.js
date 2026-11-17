import { CONFIG } from '../config.js';
import { Api } from '../services/api.js';
import { catalog } from './catalog.js';
import { bus, appState } from './store.js';

const STOP = CONFIG.COMMANDS.STOP;

/**
 * ÚNICO servicio de envío de comandos (palancas + botones + DETENER).
 *
 * Reglas:
 *  - DETENER tiene prioridad absoluta: se envía siempre, invalida lo pendiente y,
 *    si había un movimiento en vuelo, se reafirma al terminar ese movimiento.
 *  - Un solo movimiento en vuelo; de las palancas se conserva solo el último (sin ráfagas).
 *  - Con una palanca en uso, la otra palanca y los botones quedan bloqueados.
 *  - Con una DEMO en ejecución solo se admite DETENER.
 *
 * Trazabilidad publicada en bus 'cmd:trace':
 *  requested (solicitado) → accepted (aceptado por API, HTTP 201) → event (evento WSS recibido).
 *  Ninguna fase implica ejecución física en los motores.
 */
class CommandService {
  #inFlight = false;
  #pending = null;
  #gen = 0;          // se incrementa con cada DETENER: invalida respuestas tardías
  #seq = 0;
  #owner = null;     // 'drive' | 'arm' | null
  #awaitingEvent = new Map();   // nombre -> seq que espera su evento WSS

  constructor() {
    bus.on('ws:message', (m) => {
      if (m.tipo !== 'movimiento' || m.origen !== CONFIG.ORIGEN) return;
      const seq = this.#awaitingEvent.get(m.comando);
      if (seq === undefined) return;
      this.#awaitingEvent.delete(m.comando);
      bus.emit('cmd:trace', { seq, name: m.comando, phase: 'event', at: m.timestamp });
    });
  }

  get owner() { return this.#owner; }
  get busy() { return this.#inFlight; }

  /** Una palanca toma (o libera) el control exclusivo. */
  claim(owner) {
    if (this.#owner && this.#owner !== owner) return false;
    this.#owner = owner;
    bus.emit('cmd:owner', owner);
    return true;
  }

  release(owner) {
    if (this.#owner !== owner) return;
    this.#owner = null;
    bus.emit('cmd:owner', null);
  }

  /**
   * @param {string} name nombre del comando en el catálogo (p. ej. 'AVANZAR')
   * @param {{source:'drive'|'arm'|'button'|'stop', repeat?:boolean}} opts
   *        repeat = reenvío periódico de una palanca sostenida (se omite si hay uno en vuelo).
   */
  send(name, { source = 'button', repeat = false } = {}) {
    name = String(name).toUpperCase();
    const cmd = catalog.get(name);
    if (!cmd) { this.#trace(name, 'blocked', 'Comando no disponible en el catálogo'); return false; }

    if (name === STOP) {
      this.#gen++;
      this.#pending = null;
      this.#dispatch(cmd, this.#gen);
      return true;
    }
    if (appState.demoRunning) { if (!repeat) this.#trace(name, 'blocked', 'DEMO en curso: usa Cancelar o DETENER'); return false; }
    if (this.#owner && this.#owner !== source) {
      this.#trace(name, 'blocked', source === 'button' ? 'Suelta la palanca para usar los botones' : 'La otra palanca está en uso');
      return false;
    }
    if (this.#inFlight) {
      if (repeat) return 'skipped';                       // nunca se acumulan reenvíos
      if (source === 'drive' || source === 'arm') { this.#pending = { cmd, gen: this.#gen }; return 'queued'; }
      this.#trace(name, 'blocked', 'Espera la respuesta anterior');
      return false;
    }
    this.#dispatch(cmd, this.#gen);
    return true;
  }

  async #dispatch(cmd, gen) {
    const isStop = cmd.nombre === STOP;
    const seq = ++this.#seq;
    if (!isStop) this.#inFlight = true;
    this.#awaitingEvent.set(cmd.nombre, seq);
    bus.emit('cmd:trace', { seq, name: cmd.nombre, phase: 'requested' });

    try {
      await Api.movimiento(cmd.id);
      // Una respuesta tardía de un movimiento previo a DETENER no vuelve a "activar" la UI.
      if (isStop || gen === this.#gen) bus.emit('cmd:trace', { seq, name: cmd.nombre, phase: 'accepted' });
      else bus.emit('cmd:trace', { seq, name: cmd.nombre, phase: 'superseded' });
    } catch (e) {
      this.#awaitingEvent.delete(cmd.nombre);
      bus.emit('cmd:trace', { seq, name: cmd.nombre, phase: 'error', msg: e.message });
    } finally {
      if (!isStop) {
        this.#inFlight = false;
        if (gen !== this.#gen) {
          // Hubo DETENER mientras este movimiento viajaba: se reafirma para que el estado final sea DETENER.
          const stop = catalog.get(STOP);
          if (stop) this.#dispatch(stop, this.#gen);
        } else if (this.#pending && this.#pending.gen === this.#gen) {
          const p = this.#pending;
          this.#pending = null;
          this.#dispatch(p.cmd, p.gen);
        }
      }
    }
  }

  #trace(name, phase, msg) {
    bus.emit('cmd:trace', { seq: ++this.#seq, name, phase, msg });
  }
}

export const commands = new CommandService();
