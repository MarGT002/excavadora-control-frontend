import { Api } from '../services/api.js';
import { toast } from '../ui/toast.js';
import { bus } from './store.js';
import { session } from './session.js';
import { vehicle } from './vehicle.js';

/**
 * Reserva temporal del Invitado. El tiempo y la exclusividad los impone el BACKEND
 * (al vencer, el servidor detiene la unidad, libera la reserva y cierra el WSS con 4408);
 * aquí solo se muestra la cuenta regresiva y se reacciona a esos eventos.
 */
class Reserva {
  #deadline = null;
  #timer = null;

  constructor() {
    bus.on('reserva:refresh', () => this.refresh());
    bus.on('session:changed', () => (session.isGuest ? this.refresh() : this.#stop()));
    bus.on('ws:message', (m) => { if (m.tipo === 'reserva_fin') this.#ended(m.motivo); });
    bus.on('ws:denied', (d) => { if (d.kind === 'reservation') this.#ended('EXPIRADA'); });
  }

  async refresh() {
    if (!session.isGuest) return;
    try {
      const r = await Api.reserva();
      this.#deadline = Date.now() + Math.max(0, r.segundos_restantes) * 1000;
      if (vehicle.current?.id !== r.id_vehiculo) {
        vehicle.setReserved({ id: r.id_vehiculo, nombre: 'Unidad de exhibición', codigo: '', estado: 'EXHIBICION', activo: true });
      }
      this.#start();
    } catch (e) {
      if (e.status === 404 || e.status === 401) { this.#stop(); vehicle.setReserved(null); }
    }
    bus.emit('reserva:changed');
  }

  #start() {
    clearInterval(this.#timer);
    const tick = () => {
      const seg = Math.max(0, Math.ceil((this.#deadline - Date.now()) / 1000));
      bus.emit('reserva:tick', seg);
      if (seg === 0) { clearInterval(this.#timer); setTimeout(() => this.refresh(), 1500); }
    };
    tick();
    this.#timer = setInterval(tick, 1000);
  }

  #stop() {
    clearInterval(this.#timer);
    this.#timer = null;
    this.#deadline = null;
    bus.emit('reserva:tick', null);
  }

  #ended(motivo) {
    if (!session.isGuest) return;
    this.#stop();
    vehicle.setReserved(null);
    const txt = { EXPIRADA: 'Se acabó el tiempo de prueba', DESCONEXION: 'La prueba terminó por desconexión',
      REVOCADA: 'La empresa retiró la unidad de exhibición', FINALIZADA: 'Prueba finalizada' }[motivo] || 'La prueba terminó';
    toast(`${txt}. El vehículo se detuvo de forma segura.`, 'info', 5000);
    location.hash = 'inicio';
    bus.emit('reserva:changed');
  }
}

export const reserva = new Reserva();
