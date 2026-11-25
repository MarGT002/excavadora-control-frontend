import { bus } from '../core/store.js';
import { session } from '../core/session.js';
import { vehicle } from '../core/vehicle.js';
import { Api } from '../services/api.js';
import { toast } from '../ui/toast.js';
import { commandLabel } from '../utils/format.js';
import { el, icon } from '../utils/dom.js';
import { go } from './router.js';

const $ = (id) => document.getElementById(id);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * INICIO
 *  - Sin sesión: tarjeta mínima con dos pestañas (Iniciar sesión / Crear cuenta) y un enlace para probar como invitado.
 *    El registro pide un código de 6 dígitos que llega por correo; al verificarlo se entra directamente.
 *  - Invitado: unidades de exhibición libres y el catálogo de modelos.
 */
export class InicioView {
  #pendingEmail = '';
  #resendTimer = null;

  constructor() {
    $('login-form').addEventListener('submit', (e) => { e.preventDefault(); this.#login(); });
    $('signup-form').addEventListener('submit', (e) => { e.preventDefault(); this.#signup(); });
    $('verify-form').addEventListener('submit', (e) => { e.preventDefault(); this.#verify(); });
    $('verify-resend').addEventListener('click', () => this.#resend());
    $('verify-back').addEventListener('click', () => this.#showTab('signup'));
    $('guest-btn').addEventListener('click', () => this.#guest());
    $('verify-code').addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
      if (e.target.value.length === 6) this.#verify();
    });
    this.#initTabs();
    document.querySelectorAll('.pass-eye').forEach((b) => b.addEventListener('click', () => {
      const input = $(b.dataset.eye);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
      b.firstElementChild.className = `bi ${show ? 'bi-eye-slash' : 'bi-eye'}`;
    }));
    bus.on('view:changed', (v) => { if (v === 'inicio') this.refresh(); });
    bus.on('session:changed', () => this.#renderSide());
    bus.on('reserva:changed', () => this.#renderGuest());
  }

  refresh() {
    this.#renderSide();
    if (session.isGuest) this.#renderCatalog();
  }

  // ---------------------------------------------------------------- pestañas
  #initTabs() {
    const tabs = [$('tab-login'), $('tab-signup')];
    tabs.forEach((t) => t.addEventListener('click', () => this.#showTab(t.id === 'tab-login' ? 'login' : 'signup')));
    $('auth-tabs').addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const next = document.activeElement === tabs[0] ? tabs[1] : tabs[0];
      next.focus();
      next.click();
    });
  }

  /** 'login' | 'signup' | 'verify' */
  #showTab(name) {
    const isLogin = name === 'login';
    $('tab-login').setAttribute('aria-selected', String(isLogin));
    $('tab-signup').setAttribute('aria-selected', String(name !== 'login'));
    $('tab-login').tabIndex = isLogin ? 0 : -1;
    $('tab-signup').tabIndex = isLogin ? -1 : 0;
    $('login-form').hidden = !isLogin;
    $('signup-form').hidden = name !== 'signup';
    $('verify-form').hidden = name !== 'verify';
    $('auth-tabs').hidden = name === 'verify';
    ['login-error', 'signup-error', 'verify-error'].forEach((id) => { $(id).hidden = true; });
    const focus = { login: 'login-email', signup: 'su-nombre', verify: 'verify-code' }[name];
    requestAnimationFrame(() => $(focus)?.focus());
  }

  #error(id, msg) {
    const e = $(id);
    e.textContent = msg;
    e.hidden = !msg;
  }

  async #busy(btnId, fn) {
    const btn = $(btnId);
    btn.disabled = true;
    btn.classList.add('is-busy');
    try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('is-busy'); }
  }

  // ---------------------------------------------------------------- login
  async #login() {
    this.#error('login-error', '');
    const email = $('login-email').value.trim();
    const pass = $('login-pass').value;
    if (!email || !pass) { this.#error('login-error', 'Escribe tu correo (o usuario) y contraseña.'); return; }
    await this.#busy('login-submit', async () => {
      try {
        await session.login(email, pass);
        $('login-pass').value = '';
      } catch (e) {
        if (e.status === 403) {                         // contraseña correcta pero correo sin verificar
          this.#toVerify(email);
          try { await Api.reenviarCodigo(email); this.#startResendCooldown(45); } catch { /* el anterior aún sirve */ }
          this.#error('verify-error', 'Tu correo aún no está verificado. Ingresa el código que te enviamos.');
          return;
        }
        this.#error('login-error', e.status === 401 ? 'Usuario o contraseña incorrectos.' : e.message);
      }
    });
  }

  // ---------------------------------------------------------------- registro
  async #signup() {
    this.#error('signup-error', '');
    const d = {
      nombre: $('su-nombre').value.trim(),
      email: $('su-email').value.trim().toLowerCase(),
      telefono: $('su-tel').value.trim() || null,
      password: $('su-pass').value
    };
    if (d.nombre.length < 2) return this.#error('signup-error', 'Escribe tu nombre.');
    if (!EMAIL_RE.test(d.email)) return this.#error('signup-error', 'Escribe un correo válido.');
    if (d.telefono && !/^[0-9+()\- ]{7,30}$/.test(d.telefono)) return this.#error('signup-error', 'El teléfono solo admite números, espacios, +, ( ) y -.');
    if (d.password.length < 8) return this.#error('signup-error', 'La contraseña debe tener al menos 8 caracteres.');
    await this.#busy('signup-submit', async () => {
      try {
        const r = await Api.registro(d);
        $('su-pass').value = '';
        this.#toVerify(d.email);
        this.#startResendCooldown(r.reenviar_en_seg || 45);
        toast(r.mensaje || 'Te enviamos un código a tu correo', 'ok', 5000);
      } catch (e) {
        if (e.status === 409) {
          this.#showTab('login');
          $('login-email').value = d.email;
          this.#error('login-error', 'Ese correo ya tiene una cuenta. Inicia sesión.');
          return;
        }
        this.#error('signup-error', e.status === 422 ? 'Revisa los datos del formulario.' : e.message);
      }
    });
  }

  #toVerify(email) {
    this.#pendingEmail = email;
    $('verify-email').textContent = email;
    $('verify-code').value = '';
    this.#showTab('verify');
  }

  async #verify() {
    const code = $('verify-code').value.trim();
    if (!/^\d{6}$/.test(code)) { this.#error('verify-error', 'El código tiene 6 dígitos.'); return; }
    if ($('verify-submit').disabled) return;
    this.#error('verify-error', '');
    await this.#busy('verify-submit', async () => {
      try {
        await session.verify(this.#pendingEmail, code);
        toast('¡Cuenta verificada! Bienvenido.', 'ok');
        this.#showTab('login');
      } catch (e) {
        $('verify-code').value = '';
        this.#error('verify-error', e.message);
      }
    });
  }

  async #resend() {
    if (!this.#pendingEmail) return;
    try {
      const r = await Api.reenviarCodigo(this.#pendingEmail);
      toast('Código reenviado. Revisa también la carpeta de spam.', 'ok');
      this.#startResendCooldown(r.reenviar_en_seg || 45);
    } catch (e) {
      this.#error('verify-error', e.message);
      const s = Number(/(\d+)\s*s/.exec(e.message)?.[1]);
      if (e.status === 429 && s) this.#startResendCooldown(s);
    }
  }

  #startResendCooldown(seconds) {
    const btn = $('verify-resend');
    clearInterval(this.#resendTimer);
    let left = seconds;
    const paint = () => {
      btn.disabled = left > 0;
      btn.textContent = left > 0 ? `Reenviar en ${left}s` : 'Reenviar código';
    };
    paint();
    this.#resendTimer = setInterval(() => { left -= 1; paint(); if (left <= 0) clearInterval(this.#resendTimer); }, 1000);
  }

  async #guest() {
    try { await session.guest(); }
    catch (e) { toast(`No se pudo abrir la sesión de invitado: ${e.message}`, 'error'); }
  }

  // ---------------------------------------------------------------- invitado
  #renderSide() {
    $('auth-wrap').hidden = Boolean(session.role);
    $('guest-wrap').hidden = !session.isGuest;
    if (session.isGuest) this.#renderGuest();
  }

  async #renderCatalog() {
    const box = $('catalog');
    try {
      const modelos = await Api.catalogo();
      if (!modelos.length) { box.replaceChildren(); return; }
      box.replaceChildren(...modelos.map((m) => {
        const caps = Array.isArray(m.capacidades) ? m.capacidades : [];
        return el('article', { class: 'model-card' },
          el('div', { class: 'model-art', 'aria-hidden': 'true' },
            el('img', { src: m.imagen_url || './assets/img/favicon.svg', alt: '', loading: 'lazy' })),
          el('div', { class: 'model-body' },
            el('h3', { class: 'model-name' }, m.nombre),
            el('p', { class: 'model-desc' }, m.descripcion || 'Vehículo IoT controlado desde la nube.'),
            el('ul', { class: 'cap-list', 'aria-label': 'Funciones disponibles en la prueba' },
              caps.filter((c) => c.en_prueba).map((c) => el('li', { class: 'is-demo' }, commandLabel(c.nombre))))));
      }));
    } catch {
      box.replaceChildren();
    }
  }

  async #renderGuest() {
    if (!session.isGuest) return;
    const box = $('guest-reserva');
    const list = $('exhib-list');
    let reserva = null;
    try { reserva = await Api.reserva(); } catch { reserva = null; }

    if (reserva) {
      box.replaceChildren(
        el('p', { class: 'guest-active' }, icon('bi-check-circle-fill'), ` Unidad reservada · ${Math.ceil(reserva.segundos_restantes / 60)} min restantes`),
        el('div', { class: 'btn-row' },
          el('button', { type: 'button', class: 'btn-primary', onclick: () => go('control') }, icon('bi-controller'), ' Ir al control'),
          el('button', { type: 'button', class: 'btn-ghost', onclick: () => this.#endReserva() }, 'Terminar prueba')));
      list.replaceChildren();
      return;
    }
    box.replaceChildren(el('p', { class: 'muted' }, 'Elige una unidad libre.'));
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
