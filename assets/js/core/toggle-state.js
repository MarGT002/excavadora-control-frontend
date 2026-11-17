import { CONFIG } from '../config.js';
import { bus, appState } from './store.js';

const C = CONFIG.COMMANDS;
const KEY = 'excavadora.toggles';

/**
 * Estado ON/OFF ESTIMADO de las funciones que en el vehículo funcionan como interruptor
 * (cada pulso alterna): ENCENDER, LUCES y BOCINA.
 *
 * El backend no guarda este estado y el vehículo aún no reporta telemetría, así que se deduce
 * de los comandos publicados: con la sesión WSS en línea se usa el evento «movimiento» (o
 * «demo_movimiento») de CUALQUIER origen, de modo que todas las pestañas coinciden; sin WSS se
 * usa la aceptación HTTP de esta pestaña. Al encender el vehículo las luces quedan encendidas
 * (comportamiento del carrito) y al apagarlo todo vuelve a OFF.
 */
class ToggleState {
  #s = { power: false, lights: false, horn: false };

  constructor() {
    try { Object.assign(this.#s, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* sin almacenamiento */ }

    bus.on('ws:message', (m) => {
      if (m.tipo === 'movimiento' || m.tipo === 'demo_movimiento') this.#apply(m.comando);
    });
    bus.on('cmd:trace', (t) => {
      if (t.phase === 'accepted' && appState.wsStatus !== 'ONLINE') this.#apply(t.name);
    });
  }

  get state() { return { ...this.#s }; }

  #apply(name) {
    const s = this.#s;
    switch (String(name).toUpperCase()) {
      case C.POWER:
        s.power = !s.power;
        s.lights = s.power;      // al encender, las luces arrancan encendidas
        s.horn = false;
        break;
      case C.LIGHTS: s.lights = !s.lights; break;
      case C.HORN: s.horn = !s.horn; break;
      default: return;
    }
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* sin almacenamiento */ }
    bus.emit('toggles:changed', this.state);
  }
}

export const toggles = new ToggleState();
