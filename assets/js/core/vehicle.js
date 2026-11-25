import { active } from '../config.js';
import { Api } from '../services/api.js';
import { bus, appState } from './store.js';
import { session } from './session.js';

const KEY = 'excavadora.unidad';

/**
 * Unidad activa: la que operan CONTROL y MONITOREO.
 *  - Admin: inventario (las vendidas solo funcionan con soporte del dueño; el backend responde 403 si no).
 *  - Usuario: solo «Mis vehículos».
 *  - Invitado: solo la unidad de exhibición reservada.
 * Al cambiar, se emite 'vehicle:changed' para que WSS, catálogo, demos y monitoreo se reconfiguren
 * (la suscripción WSS anterior se cierra antes de abrir la nueva).
 */
class VehicleContext {
  list = [];
  current = null;

  async loadForSession() {
    if (session.isAdmin) this.list = await Api.unidades();
    else if (session.isUser) this.list = await Api.misVehiculos();
    else this.list = [];
    let pref = null;
    try { pref = Number(sessionStorage.getItem(KEY)); } catch { /* sin almacenamiento */ }
    const pick = this.list.find((u) => u.id === pref) ?? this.list.find((u) => u.estado !== 'VENDIDO' && u.activo) ?? this.list[0] ?? null;
    this.select(pick?.id ?? null, { force: true });
    bus.emit('vehicles:list', this.list);
  }

  /** Recarga la lista (p. ej. presencia del ESP) sin cambiar la unidad seleccionada. */
  async refreshList() {
    if (session.isAdmin) this.list = await Api.unidades();
    else if (session.isUser) this.list = await Api.misVehiculos();
    else return;
    const cur = this.list.find((u) => u.id === this.current?.id);
    if (cur) this.current = cur;
    bus.emit('vehicles:list', this.list);
  }

  /** Invitado: la unidad viene de su reserva. */
  setReserved(unit) {
    this.list = unit ? [unit] : [];
    this.select(unit?.id ?? null, { force: true });
    bus.emit('vehicles:list', this.list);
  }

  select(id, { force = false } = {}) {
    const next = id === null ? null : (this.list.find((u) => u.id === Number(id)) ?? null);
    if (!force && next?.id === this.current?.id) return;
    this.current = next;
    active.vehicleId = next?.id ?? null;
    appState.vehicleName = next?.nombre ?? '';
    try { if (next) sessionStorage.setItem(KEY, String(next.id)); } catch { /* sin almacenamiento */ }
    bus.emit('vehicle:changed', next);
  }

  clear() {
    this.list = [];
    this.select(null, { force: true });
  }
}

export const vehicle = new VehicleContext();
