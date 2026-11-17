import { Api } from '../services/api.js';
import { bus, appState } from './store.js';

const SILENCE_LIMIT_MS = 90000;   // sin eventos de la DEMO durante este tiempo => estado desconocido

/**
 * Coordinación de DEMO existentes. La secuencia, orden, duración y pausa las ejecuta el BACKEND;
 * aquí solo se inicia/cancela y se refleja el progreso con los eventos WSS reales:
 * demo_inicio → demo_movimiento (N) → demo_fin | demo_cancelada | error.
 * Publica 'demo:state' con { phase, id, nombre, orden, total, comando, message }.
 */
class DemoService {
  #state = { phase: 'idle', id: null, nombre: '', orden: 0, total: 0, comando: '', message: '' };
  #busy = false;
  #silenceTimer = null;

  constructor() {
    bus.on('ws:message', (m) => this.#onEvent(m));
  }

  get state() { return { ...this.#state }; }

  async start(demo) {
    if (this.#busy || appState.demoRunning) return;
    this.#busy = true;
    this.#set({ phase: 'starting', id: demo.id, nombre: demo.nombre, orden: 0, total: 0, comando: '', message: 'Solicitando inicio…' });
    try {
      const r = await Api.iniciarDemo(demo.id);
      // El evento demo_inicio puede llegar antes que la respuesta HTTP.
      if (this.#state.phase === 'starting') {
        this.#set({ phase: 'running', total: Number(r?.total_movimientos) || 0, message: 'Aceptada por API (202). Esperando eventos…' });
      }
    } catch (e) {
      if (e.status === 409) {
        this.#set({ phase: 'running', message: 'Ya hay una DEMO en ejecución en este vehículo' });
      } else {
        this.#set({ phase: 'error', message: e.message });
      }
    } finally {
      this.#busy = false;
    }
  }

  /** Cancela la DEMO en curso. Devuelve true si la API la aceptó o no había nada que cancelar. */
  async cancel() {
    if (!appState.demoRunning && this.#state.phase !== 'starting') return true;
    this.#set({ phase: 'cancelling', message: 'Solicitando cancelación…' });
    try {
      await Api.cancelarDemo();
      return true;
    } catch (e) {
      if (e.status === 404) { this.#finish('idle', 'No había una DEMO en ejecución'); return true; }
      this.#set({ phase: 'running', message: `No se pudo cancelar: ${e.message}` });
      return false;
    }
  }

  #onEvent(m) {
    switch (m.tipo) {
      case 'demo_inicio':
        this.#set({ phase: 'running', id: m.idDemo, nombre: m.nombre || this.#state.nombre, total: m.total ?? 0, orden: 0, message: 'DEMO iniciada (evento WSS)' });
        break;
      case 'demo_movimiento':
        if (!appState.demoRunning) this.#set({ phase: 'running', id: m.idDemo });
        this.#set({ orden: m.orden ?? this.#state.orden, comando: m.comando, message: `Paso ${m.orden ?? '?'}: ${m.comando}` });
        break;
      case 'demo_fin':
        this.#finish('done', 'DEMO finalizada (evento WSS)');
        break;
      case 'demo_cancelada':
        this.#finish('cancelled', 'DEMO cancelada (evento WSS)');
        break;
      case 'error':
        if (m.idDemo !== null) this.#finish('error', m.detalle || 'La DEMO terminó con error');
        break;
      default:
    }
  }

  #finish(phase, message) {
    this.#set({ phase, message });
  }

  #set(patch) {
    this.#state = { ...this.#state, ...patch };
    const running = ['starting', 'running', 'cancelling'].includes(this.#state.phase);
    appState.demoRunning = running;
    appState.demoId = running ? this.#state.id : null;

    clearTimeout(this.#silenceTimer);
    if (running) {
      this.#silenceTimer = setTimeout(() => this.#finish('unknown', 'Sin eventos de la DEMO: estado desconocido'), SILENCE_LIMIT_MS);
    }
    bus.emit('demo:state', this.state);
  }
}

export const demos = new DemoService();
