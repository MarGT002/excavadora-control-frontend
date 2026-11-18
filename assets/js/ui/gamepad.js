import { CONFIG } from '../config.js';
import { bus } from '../core/store.js';

/**
 * Control físico (GameSir, Xbox, PlayStation…) con la Gamepad API estándar del navegador.
 * Funciona por USB o Bluetooth en computadora (Chrome/Edge/Firefox) y en celular (Chrome Android, Safari iOS 16+).
 * En modo XInput/«Xbox» el GameSir usa la asignación estándar (mapping === 'standard').
 *
 *   Stick izquierdo / Cruceta  → Orugas (AVANZAR, RETROCEDER, GIRAR_IZQUIERDA, GIRAR_DERECHA)
 *   Stick derecho              → Brazo (arriba/abajo) · Pala (izquierda abre / derecha cierra)
 *   B / Círculo · Start        → DETENER         A / Cruz      → LUCES
 *   X / Cuadrado               → ENCENDER        Y / Triángulo → BOCINA
 *
 * Solo emite TRANSICIONES (como las palancas en pantalla). Se publica en el bus:
 *   'gamepad:status' {connected, name} · 'gamepad:dir' {stick:'drive'|'arm', dir} · 'gamepad:button' {action}
 */
const BTN = { A: 0, B: 1, X: 2, Y: 3, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const ACTIONS = { [BTN.A]: 'LUCES', [BTN.B]: 'STOP', [BTN.X]: 'ENCENDER', [BTN.Y]: 'BOCINA', [BTN.START]: 'STOP' };

function dirFrom(x, y, dz) {
  if (Math.hypot(x, y) < dz) return null;
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'down' : 'up';
}

class GamepadInput {
  #index = null;
  #raf = null;
  #enabled = false;
  #last = { drive: null, arm: null };
  #pressed = new Set();

  constructor() {
    window.addEventListener('gamepadconnected', (e) => this.#attach(e.gamepad));
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index !== this.#index) return;
      this.#index = null;
      this.info = { connected: false, name: '' };
      this.#neutral();
      bus.emit('gamepad:status', { connected: false, name: '' });
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.#neutral(); else this.#loop(); });
    // Algunos navegadores ya tenían el control antes de cargar la página.
    const pads = navigator.getGamepads?.() || [];
    for (const p of pads) if (p) { this.#attach(p); break; }
  }

  /** Solo lee el control mientras la vista CONTROL está visible. */
  setEnabled(on) {
    this.#enabled = on;
    if (!on) this.#neutral();
    this.#loop();
  }

  get connected() { return this.#index !== null; }
  info = { connected: false, name: '' };

  #attach(gp) {
    if (this.#index !== null) return;
    this.#index = gp.index;
    const name = (gp.id || 'Control').replace(/\(.*?\)/g, '').trim().slice(0, 40) || 'Control';
    this.info = { connected: true, name };
    bus.emit('gamepad:status', { connected: true, name, standard: gp.mapping === 'standard' });
    this.#loop();
  }

  #loop() {
    if (this.#raf || !this.#enabled || this.#index === null) return;
    const tick = () => {
      this.#raf = null;
      if (!this.#enabled || this.#index === null) return;
      const gp = navigator.getGamepads?.()[this.#index];
      if (gp) this.#read(gp);
      this.#raf = requestAnimationFrame(tick);
    };
    this.#raf = requestAnimationFrame(tick);
  }

  #read(gp) {
    const dz = CONFIG.GAMEPAD_DEADZONE;
    const b = (i) => Boolean(gp.buttons[i]?.pressed);
    // Cruceta tiene prioridad sobre el stick izquierdo.
    const dpad = b(BTN.UP) ? 'up' : b(BTN.DOWN) ? 'down' : b(BTN.LEFT) ? 'left' : b(BTN.RIGHT) ? 'right' : null;
    const drive = dpad ?? dirFrom(gp.axes[0] ?? 0, gp.axes[1] ?? 0, dz);
    const arm = dirFrom(gp.axes[2] ?? 0, gp.axes[3] ?? 0, dz);
    this.#emitDir('drive', drive);
    this.#emitDir('arm', arm);

    for (const [i, action] of Object.entries(ACTIONS)) {
      const down = b(Number(i));
      if (down && !this.#pressed.has(i)) { this.#pressed.add(i); bus.emit('gamepad:button', { action }); }
      else if (!down) this.#pressed.delete(i);
    }
  }

  #emitDir(stick, dir) {
    if (this.#last[stick] === dir) return;
    this.#last[stick] = dir;
    bus.emit('gamepad:dir', { stick, dir });
  }

  #neutral() {
    for (const stick of ['drive', 'arm']) this.#emitDir(stick, null);
    this.#pressed.clear();
    if (this.#raf) { cancelAnimationFrame(this.#raf); this.#raf = null; }
  }
}

export const gamepad = new GamepadInput();
