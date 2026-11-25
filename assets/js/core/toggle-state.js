import { CONFIG, active } from '../config.js';
import { bus, appState } from './store.js';

const C = CONFIG.COMMANDS;
const KEY = 'excavadora.toggles.v2';       // { [id_vehiculo]: { power, lights, horn } }
const OFF = Object.freeze({ power: false, lights: false, horn: false });

/**
 * Estado ON/OFF ESTIMADO de las funciones que en el carrito funcionan como interruptor
 * (cada pulso alterna): ENCENDER, LUCES y BOCINA.
 *
 * El ESP8266 no reporta el estado de sus relevadores, así que se deduce de los comandos publicados:
 *  - con la sesión WSS en línea, del evento «movimiento» / «demo_movimiento» (de CUALQUIER origen,
 *    así todas las pestañas coinciden); sin WSS, de la aceptación HTTP de esta pestaña.
 *  - el estado se guarda POR UNIDAD y arranca en OFF (antes era global y una sesión anterior podía dejarlo
 *    invertido: el botón aparecía encendido con el carrito apagado y al encenderlo se mostraba apagado).
 *  - si el carrito se reinició o alguien lo operó sin la app, el usuario corrige el indicador manteniendo
 *    presionado el botón (o clic derecho): solo cambia el indicador, NO envía comando.
 */
class ToggleState {
  #all = {};

  constructor() {
    try {
      localStorage.removeItem('excavadora.toggles');            // formato anterior (global): causa de la inversión
      this.#all = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    } catch { this.#all = {}; }

    bus.on('ws:message', (m) => {
      if (m.tipo === 'movimiento' || m.tipo === 'demo_movimiento') this.#apply(m.comando, m.id_vehiculo ?? m.idVehiculo);
    });
    bus.on('cmd:trace', (t) => {
      if (t.phase === 'accepted' && appState.wsStatus !== 'ONLINE') this.#apply(t.name, active.vehicleId);
    });
    bus.on('vehicle:changed', () => bus.emit('toggles:changed', this.state));
  }

  get state() { return { ...OFF, ...(this.#all[active.vehicleId] || {}) }; }

  /** Corrección manual del indicador (sin enviar comando). */
  flip(key) {
    if (active.vehicleId === null || !(key in OFF)) return;
    const s = this.state;
    s[key] = !s[key];
    if (key === 'power' && !s.power) { s.lights = false; s.horn = false; }
    this.#save(active.vehicleId, s);
  }

  #apply(name, idVehiculo) {
    const id = Number(idVehiculo ?? active.vehicleId);
    if (!Number.isFinite(id)) return;
    const s = { ...OFF, ...(this.#all[id] || {}) };
    switch (String(name).toUpperCase()) {
      case C.POWER:
        s.power = !s.power;
        s.lights = s.power;      // al encender, las luces arrancan encendidas (comportamiento del carrito)
        s.horn = false;
        break;
      case C.LIGHTS: s.lights = !s.lights; break;
      case C.HORN: s.horn = !s.horn; break;
      default: return;
    }
    this.#save(id, s);
  }

  #save(id, s) {
    this.#all[id] = s;
    try { localStorage.setItem(KEY, JSON.stringify(this.#all)); } catch { /* sin almacenamiento */ }
    if (id === active.vehicleId) bus.emit('toggles:changed', this.state);
  }
}

export const toggles = new ToggleState();
