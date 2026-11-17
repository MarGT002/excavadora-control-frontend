/**
 * Bus de eventos mínimo compartido por CONTROL y MONITOREO.
 * Evita acoplar módulos entre sí: cada uno publica/escucha eventos con nombre.
 */
class EventBus {
  #handlers = new Map();

  on(type, fn) {
    if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
    this.#handlers.get(type).add(fn);
    return () => this.#handlers.get(type)?.delete(fn);
  }

  emit(type, payload) {
    this.#handlers.get(type)?.forEach((fn) => {
      try { fn(payload); } catch (e) { console.error(`[bus:${type}]`, e); }
    });
  }
}

export const bus = new EventBus();

/** Estado operativo compartido (solo lectura fuera de los servicios que lo modifican). */
export const appState = {
  vehicleName: '',
  demoRunning: false,
  demoId: null,
  wsStatus: 'CONNECTING'
};
