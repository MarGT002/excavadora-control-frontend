import { CONFIG } from '../config.js';
import { Api } from '../services/api.js';
import { bus } from './store.js';

/**
 * Verificación periódica y moderada de:
 *  - API AWS (GET /health): OK | CHECKING | DOWN
 *  - Amazon RDS (GET /health/db, diagnóstico del backend): OK | DOWN | UNKNOWN ("Sin verificar")
 * Si la API no responde, RDS pasa a "Sin verificar": no se atribuye la caída a la base sin evidencia.
 * Publica 'health:api' y 'health:db' con { state, at }.
 */
class Connectivity {
  #timer = null;
  #running = false;
  #apiState = null;

  start() {
    this.check();
    this.#timer = setInterval(() => this.check(), CONFIG.HEALTH_INTERVAL_MS);
    window.addEventListener('online', () => this.check());
    window.addEventListener('offline', () => this.#emit('api', 'DOWN'));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.check(); });
  }

  async check() {
    if (this.#running) return;          // evita verificaciones solapadas
    this.#running = true;
    if (this.#apiState !== 'OK') this.#emit('api', 'CHECKING');
    try {
      const apiOk = await this.#checkApi();
      this.#emit('api', apiOk ? 'OK' : 'DOWN');
      if (!apiOk) { this.#emit('db', 'UNKNOWN'); return; }
      try {
        const db = await Api.healthDb();
        this.#emit('db', db === 'ok' ? 'OK' : db === 'down' ? 'DOWN' : 'UNKNOWN');
      } catch {
        this.#emit('db', 'UNKNOWN');
      }
    } finally {
      this.#running = false;
    }
  }

  async #checkApi() {
    try {
      return await Api.healthApi();
    } catch (e) {
      // Si el backend aún no tiene /health, se usa una operación de lectura documentada (detalle del vehículo).
      if (e.status === 404) {
        try { await Api.vehiculo(); return true; } catch { return false; }
      }
      return false;
    }
  }

  #emit(key, state) {
    if (key === 'api') this.#apiState = state;
    bus.emit(`health:${key}`, { state, at: new Date() });
  }
}

export const connectivity = new Connectivity();
