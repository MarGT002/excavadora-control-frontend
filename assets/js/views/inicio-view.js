import { bus } from '../core/store.js';
import { session } from '../core/session.js';
import { vehicle } from '../core/vehicle.js';
import { Api } from '../services/api.js';
import { toast } from '../ui/toast.js';
import { commandLabel } from '../utils/format.js';
import { el, icon } from '../utils/dom.js';
import { go } from './router.js';

const $ = (id) => document.getElementById(id);

/**
 * INICIO: catálogo público («Prueba nuestros vehículos IoT»), inicio de sesión y prueba de Invitado.
 * El catálogo solo muestra datos comerciales y la disponibilidad real de las unidades de exhibición.
 */
export class InicioView {
  constructor() {
    $('login-form').addEventListener('submit', (e) => { e.preventDefault(); this.#login(); });
    $('guest-btn').addEventListener('click', () => this.#guest());
    bus.on('view:changed', (v) => { if (v === 'inicio') this.refresh(); });
    bus.on('session:changed', () => this.#renderSide());
    bus.on('reserva:changed', () => this.#renderGuest());
  }

  refresh() {
    this.#renderCatalog();
    this.#renderSide();
  }

  // ---------------------------------------------------------------- catálogo
  async #renderCatalog() {
    const box = $('catalog');
    try {
      const modelos = await Api.catalogo();
      if (!modelos.length) { box.replaceChildren(el('p', { class: 'muted' }, 'Sin modelos publicados por ahora.')); return; }
      box.replaceChildren(...modelos.map((m) => {
        const caps = Array.isArray(m.capacidades) ? m.capacidades : [];
        const ex = m.exhibicion || { unidades: 0, disponibles: 0 };
        return el('article', { class: 'model-card' },
          el('div', { class: 'model-art', 'aria-hidden': 'true' },
            m.imagen_url ? el('img', { src: m.imagen_url, alt: '', loading: 'lazy' }) : el('img', { src: './assets/img/favicon.svg', alt: '' })),
          el('div', { class: 'model-body' },
            el('h3', { class: 'model-name' }, m.nombre),
            el('p', { class: 'model-desc' }, m.descripcion || 'Vehículo IoT controlado desde la nube.'),
            el('p', { class: 'model-meta' }, icon('bi-cpu'), ` ${m.microcontrolador || 'Microcontrolador IoT'}`),
            el('ul', { class: 'cap-list', 'aria-label': 'Capacidades' },
              caps.map((c) => el('li', { class: c.en_prueba ? 'is-demo' : '', title: c.en_prueba ? 'Disponible en la prueba de invitado' : 'Solo compradores' },
                commandLabel(c.nombre)))),
            el('p', { class: `avail ${ex.disponibles ? 'avail--ok' : 'avail--no'}` },
              icon(ex.disponibles ? 'bi-check-circle-fill' : 'bi-hourglass'),
              ex.unidades ? ` ${ex.disponibles} de ${ex.unidades} unidad(es) de exhibición libres` : ' Sin unidades de exhibición')));
      }));
    } catch (e) {
      box.replaceChildren(el('p', { class: 'form-error' }, `No se pudo cargar el catálogo: ${e.message}`));
    }
  }

  // ---------------------------------------------------------------- panel lateral
  #renderSide() {
    $('login-form').hidden = Boolean(session.role);
    $('guest-card').hidden = !session.isGuest;
    if (session.isGuest) this.#renderGuest();
  }

  async #login() {
    const err = $('login-error');
    const btn = $('login-submit');
    err.hidden = true;
    const email = $('login-email').value.trim();
    const pass = $('login-pass').value;
    if (!email || !pass) { err.textContent = 'Escribe tu correo y contraseña.'; err.hidden = false; return; }
    btn.disabled = true;
    try {
      await session.login(email, pass);
      $('login-pass').value = '';
    } catch (e) {
      err.textContent = e.status === 401 ? 'Correo o contraseña incorrectos.' : e.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  async #guest() {
    try { await session.guest(); }
    catch (e) { toast(`No se pudo abrir la sesión de invitado: ${e.message}`, 'error'); }
  }

  async #renderGuest() {
    if (!session.isGuest) return;
    const box = $('guest-reserva');
    const list = $('exhib-list');
    let reserva = null;
    try { reserva = await Api.reserva(); } catch { reserva = null; }

    if (reserva) {
      box.replaceChildren(
        el('p', { class: 'guest-active' }, icon('bi-check-circle-fill'), ` Tienes reservada una unidad · ${Math.ceil(reserva.segundos_restantes / 60)} min restantes`),
        el('div', { class: 'btn-row' },
          el('button', { type: 'button', class: 'btn-primary', onclick: () => go('control') }, icon('bi-controller'), ' Ir al control'),
          el('button', { type: 'button', class: 'btn-ghost', onclick: () => this.#endReserva() }, 'Terminar prueba')));
      list.replaceChildren();
      return;
    }
    box.replaceChildren(el('p', { class: 'muted' }, 'Elige una unidad de exhibición libre para probarla.'));
    try {
      const unidades = await Api.exhibicion();
      if (!unidades.length) { list.replaceChildren(el('li', { class: 'muted' }, 'No hay unidades de exhibición en este momento.')); return; }
      list.replaceChildren(...unidades.map((u) => el('li', { class: 'exhib-item' },
        el('div', {}, el('strong', {}, u.modelo), el('span', { class: 'mono muted' }, ` ${u.codigo_unidad}`),
          el('small', { class: u.disponible ? 'ok' : 'busy' }, u.disponible ? 'Libre' : `Ocupada · ${Math.ceil((u.ocupada_seg || 0) / 60)} min`)),
        el('button', { type: 'button', class: 'btn-primary btn-sm', disabled: !u.disponible, onclick: () => this.#reservar(u) },
          u.disponible ? 'Probar' : 'Ocupada'))));
    } catch (e) {
      list.replaceChildren(el('li', { class: 'form-error' }, e.message));
    }
  }

  async #reservar(u) {
    try {
      await Api.reservar(u.id_vehiculo);
      bus.emit('reserva:refresh');
      toast('Reserva lista. ¡A manejar!', 'ok');
      go('control');
    } catch (e) {
      toast(e.message, e.status === 409 ? 'warn' : 'error');
      this.#renderGuest();
    }
  }

  async #endReserva() {
    try { await Api.terminarReserva(); } catch { /* ya no existía */ }
    vehicle.setReserved(null);
    bus.emit('reserva:refresh');
    this.#renderGuest();
  }
}
