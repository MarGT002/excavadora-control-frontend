/**
 * Palanca virtual circular (Pointer Events: mouse, táctil y lápiz) + teclado.
 * Solo notifica TRANSICIONES de dirección (up|down|left|right|null), nunca cada píxel.
 * Al soltar, cancelar el gesto, perder el puntero o la ventana, vuelve al centro y notifica null.
 */
const SECTORS = { right: 0, down: 90, left: 180, up: -90 };
const HYSTERESIS_DEG = 12;   // evita parpadeo entre direcciones cerca del límite
const DEADZONE = 0.32;       // fracción del recorrido considerada neutral

export class Joystick {
  /**
   * @param {HTMLElement} el contenedor .stick (con un hijo .stick-knob)
   * @param {{keys:Object<string,string>, canStart:()=>boolean, onChange:(dir:string|null)=>void}} opts
   */
  constructor(el, { keys = {}, canStart = () => true, onChange }) {
    this.el = el;
    this.knob = el.querySelector('.stick-knob');
    this.keys = keys;
    this.canStart = canStart;
    this.onChange = onChange;
    this.pointerId = null;
    this.keyDir = null;
    this.extDir = null;          // dirección impuesta por el control físico (gamepad)
    this.dir = null;
    this.disabled = false;
    this.#bind();
  }

  get active() { return this.pointerId !== null || this.keyDir !== null || this.extDir !== null; }

  /**
   * Dirección desde un control físico: misma lógica que el gesto táctil (mismos permisos, envío y DETENER al soltar).
   * dir = 'up'|'down'|'left'|'right' o null (stick en reposo).
   */
  setExternal(dir) {
    if (this.disabled || this.pointerId !== null || this.keyDir !== null) return;
    if (dir === null) { if (this.extDir !== null) this.release(); return; }
    if (this.extDir === null && !this.canStart()) { this.#shake(); return; }
    this.extDir = dir;
    this.el.classList.add('is-active');
    this.#placeKnob(dir);
    this.#setDir(dir);
  }

  setDisabled(v) {
    this.disabled = v;
    this.el.setAttribute('aria-disabled', String(v));
    this.el.classList.toggle('is-disabled', v);
    if (v) this.release();
  }

  #bind() {
    const el = this.el;
    el.addEventListener('pointerdown', (e) => {
      if (this.disabled || this.pointerId !== null || e.button > 0) return;
      if (!this.canStart()) { this.#shake(); return; }
      e.preventDefault();
      this.pointerId = e.pointerId;
      try { el.setPointerCapture(e.pointerId); } catch { /* puntero ya liberado */ }
      el.classList.add('is-active');
      this.#track(e);
    });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === this.pointerId) this.#track(e); });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      el.addEventListener(t, (e) => { if (e.pointerId === this.pointerId) this.release(); });
    }
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    el.addEventListener('keydown', (e) => {
      const dir = this.keys[e.key] ?? this.keys[e.key.toLowerCase()];
      if (!dir) return;
      e.preventDefault();
      if (e.repeat || this.disabled || this.pointerId !== null) return;
      if (!this.keyDir && !this.canStart()) { this.#shake(); return; }
      this.keyDir = dir;
      el.classList.add('is-active');
      this.#placeKnob(dir);
      this.#setDir(dir);
    });
    el.addEventListener('keyup', (e) => {
      const dir = this.keys[e.key] ?? this.keys[e.key.toLowerCase()];
      if (dir && dir === this.keyDir) this.release();
    });
    el.addEventListener('blur', () => { if (this.keyDir) this.release(); });

    window.addEventListener('blur', () => this.release());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.release(); });
  }

  #track(e) {
    const r = this.el.getBoundingClientRect();
    const radius = r.width / 2 - this.knob.offsetWidth / 2;
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const dist = Math.hypot(dx, dy);
    if (dist > radius) { dx = (dx / dist) * radius; dy = (dy / dist) * radius; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;

    if (dist < radius * DEADZONE) { this.#setDir(null); return; }
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    this.#setDir(this.#sector(angle));
  }

  #sector(angle) {
    const diff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
    if (this.dir && diff(angle, SECTORS[this.dir]) <= 45 + HYSTERESIS_DEG) return this.dir;
    return Object.entries(SECTORS).reduce((best, [k, a]) => (diff(angle, a) < diff(angle, SECTORS[best]) ? k : best), 'right');
  }

  #placeKnob(dir) {
    const r = this.el.getBoundingClientRect();
    const d = (r.width / 2 - this.knob.offsetWidth / 2) * 0.85;
    const v = { up: [0, -d], down: [0, d], left: [-d, 0], right: [d, 0] }[dir] ?? [0, 0];
    this.knob.style.transform = `translate(${v[0]}px, ${v[1]}px)`;
  }

  #setDir(dir) {
    if (dir === this.dir) return;          // solo transiciones
    this.dir = dir;
    if (dir) this.el.dataset.dir = dir; else delete this.el.dataset.dir;
    this.onChange(dir);
  }

  #shake() {
    this.el.classList.remove('is-denied');
    void this.el.offsetWidth;   // reinicia la animación
    this.el.classList.add('is-denied');
  }

  /** Regresa al centro; si había dirección, notifica null (=> DETENER). */
  release() {
    if (this.pointerId !== null) {
      try { this.el.releasePointerCapture(this.pointerId); } catch { /* ya liberado */ }
    }
    const wasActive = this.active || this.dir !== null;
    this.pointerId = null;
    this.keyDir = null;
    this.extDir = null;
    this.el.classList.remove('is-active');
    this.knob.style.transform = '';
    if (wasActive) {
      if (this.dir !== null) this.#setDir(null);
      else this.onChange(undefined);   // gesto sin dirección: solo libera el control
    }
  }
}
