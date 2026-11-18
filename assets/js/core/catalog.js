import { active } from '../config.js';
import { Api } from '../services/api.js';
import { bus } from './store.js';

/**
 * Catálogo real de comandos del vehículo (GET /vehiculos/{id}/comandos).
 * La UI se refiere a los comandos por nombre (AVANZAR, DETENER…) y aquí se resuelven
 * a su id_comando real. Si un nombre no existe en la API, su control queda deshabilitado.
 */
class Catalog {
  #byName = new Map();
  #byId = new Map();
  loaded = false;

  reset() {
    this.#byName.clear();
    this.#byId.clear();
    this.loaded = false;
    bus.emit('catalog:loaded', this);
  }

  async load() {
    const forVehicle = active.vehicleId;
    const list = await Api.comandos();
    if (forVehicle !== active.vehicleId) return this;       // respuesta de una unidad anterior: se descarta
    this.#byName.clear();
    this.#byId.clear();
    list.filter((c) => c.activo).forEach((c) => { this.#byName.set(c.nombre, c); this.#byId.set(c.id, c); });
    this.loaded = true;
    bus.emit('catalog:loaded', this);
    return this;
  }

  get(name) { return this.#byName.get(String(name).toUpperCase()) ?? null; }
  has(name) { return this.#byName.has(String(name).toUpperCase()); }
  byId(id) { return this.#byId.get(Number(id)) ?? null; }
  get size() { return this.#byName.size; }
}

export const catalog = new Catalog();
