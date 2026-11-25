import { Api } from '../services/api.js';
import { setAuthToken } from '../services/http.js';
import { bus } from './store.js';

const KEY = 'excavadora.sesion';

/**
 * Sesión del navegador. El token es opaco y lo emite el backend; se guarda en sessionStorage
 * (se borra al cerrar la pestaña y no se comparte con otras). El ROL que se muestra aquí solo decide
 * qué menús pintar: los permisos reales los valida FastAPI en cada petición y en el WSS.
 */
class Session {
  token = null;
  user = null;          // { tipo: 'ADMIN'|'USUARIO'|'INVITADO', id_usuario, nombre, email }

  get role() { return this.user?.tipo ?? null; }
  get isAdmin() { return this.role === 'ADMIN'; }
  get isUser() { return this.role === 'USUARIO'; }
  get isGuest() { return this.role === 'INVITADO'; }

  /** Recupera la sesión de esta pestaña y la valida con el servidor. */
  async restore() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { /* sin almacenamiento */ }
    if (!saved?.token) return false;
    this.#set(saved.token, null);
    try {
      this.#set(saved.token, await Api.me());
      return true;
    } catch {
      this.#clear();
      return false;
    }
  }

  async login(email, password) {
    this.#adopt(await Api.login(email.trim(), password));
  }

  /** Paso 2 del registro: el código correcto abre la sesión directamente. */
  async verify(email, code) {
    this.#adopt(await Api.verificar(email.trim().toLowerCase(), code));
  }

  #adopt(r) {
    this.#set(r.token, r.usuario);
    bus.emit('session:changed', this.user);
  }

  async guest() {
    const r = await Api.invitado();
    this.#set(r.token, r.usuario);
    bus.emit('session:changed', this.user);
  }

  async logout({ remote = true } = {}) {
    if (remote && this.token) { try { await Api.logout(); } catch { /* el servidor ya la cerró */ } }
    this.#clear();
    bus.emit('session:changed', null);
  }

  #set(token, user) {
    this.token = token;
    this.user = user;
    setAuthToken(token);
    try { sessionStorage.setItem(KEY, JSON.stringify({ token })); } catch { /* sin almacenamiento */ }
  }

  #clear() {
    this.token = null;
    this.user = null;
    setAuthToken(null);
    try { sessionStorage.removeItem(KEY); sessionStorage.removeItem('excavadora.unidad'); } catch { /* sin almacenamiento */ }
  }
}

export const session = new Session();
