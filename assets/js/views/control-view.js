import { CONFIG } from '../config.js';
import { bus, appState } from '../core/store.js';
import { catalog } from '../core/catalog.js';
import { commands } from '../core/command-service.js';
import { demos } from '../core/demo-service.js';
import { toggles } from '../core/toggle-state.js';
import { session } from '../core/session.js';
import { vehicle } from '../core/vehicle.js';
import { gamepad } from '../ui/gamepad.js';
import { Api } from '../services/api.js';
import { Joystick } from '../ui/joystick.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/modal.js';
import { commandLabel } from '../utils/format.js';
import { el } from '../utils/dom.js';

const C = CONFIG.COMMANDS;
const $ = (id) => document.getElementById(id);

/** Configuración de las dos palancas: dirección → nombre real del catálogo. */
const STICKS = {
  drive: {
    el: 'stick-drive', status: 'drive-status',
    map: { up: C.FORWARD, down: C.BACKWARD, left: C.LEFT, right: C.RIGHT },
    keys: { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' }
  },
  arm: {
    el: 'stick-arm', status: 'arm-status',
    map: { up: C.ARM_UP, down: C.ARM_DOWN, left: C.BUCKET_OPEN, right: C.BUCKET_CLOSE },
    keys: { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', i: 'up', k: 'down', j: 'left', l: 'right' }
  }
};

const ESTADOS = { DISPONIBLE: 'Disponible', VENDIDO: 'Vendida', EXHIBICION: 'Exhibición', INACTIVO: 'Inactiva' };
const LONG_PRESS_MS = 650;

const PHASE_TEXT = { requested: 'solicitado', accepted: 'aceptado por API', event: 'evento WSS recibido', error: 'error' };

export class ControlView {
  constructor() {
    this.sticks = {};
    this.repeatTimers = {};
    this.auxButtons = [...document.querySelectorAll('.btn-aux')];
    this.demoList = [];
    this.#initSticks();
    this.#initButtons();
    this.#initDemo();
    this.#initFeedback();
    bus.on('catalog:loaded', () => this.#syncEnabled());
    bus.on('cmd:owner', () => this.#syncEnabled());
    bus.on('toggles:changed', (s) => this.#renderToggles(s));
    this.#renderToggles(toggles.state);
    this.#initUnitAndDevices();
    this.#initUnitSwitch();
  }

  // ---------- Selector de carrito dentro de CONTROL ----------
  #initUnitSwitch() {
    const sel = $('control-unit');
    sel.addEventListener('change', () => {
      if (vehicle.current && catalog.loaded) this.stopAll();   // nunca dejar en movimiento la unidad que se abandona
      vehicle.select(sel.value);
    });
    $('btn-link-esp').addEventListener('click', () => this.#linkEsp());
    bus.on('vehicles:list', () => this.#renderUnitSwitch());
    bus.on('vehicle:changed', () => this.#renderUnitSwitch());
    bus.on('view:changed', (v) => {
      if (v === 'control' && (session.isAdmin || session.isUser)) vehicle.refreshList().catch(() => {});
    });
    // El ESP llega/se va de la unidad activa: refresca la lista para que el selector muestre dónde está.
    bus.on('ws:message', (m) => {
      if (m.tipo === 'dispositivo' && m.conectado !== null && session.isAdmin && !$('view-control').hidden) {
        clearTimeout(this.listTimer);
        this.listTimer = setTimeout(() => vehicle.refreshList().catch(() => {}), 600);
      }
    });
  }

  #renderUnitSwitch() {
    const box = $('unit-switch');
    const list = vehicle.list;
    const show = (session.isAdmin && list.length > 0) || (session.isUser && list.length > 1);
    box.hidden = !show;
    if (!show) return;
    const sel = $('control-unit');
    sel.replaceChildren(...list.map((u) => el('option', { value: u.id },
      `${u.dispositivo ? '● ' : ''}${u.codigo} · ${u.modelo || u.nombre}${session.isAdmin ? ` · ${ESTADOS[u.estado] ?? u.estado}` : ''}`)));
    if (vehicle.current) sel.value = String(vehicle.current.id);
    sel.title = 'El punto ● indica la unidad donde está conectado el ESP8266 (carrito físico)';
    // Admin: si el carrito físico está ligado a OTRA unidad, ofrecer traerlo a la seleccionada.
    const cur = vehicle.current;
    const holder = session.isAdmin && cur && !cur.tieneClave ? this.#espHolder(cur.id) : null;
    const btn = $('btn-link-esp');
    btn.hidden = !holder || cur.estado === 'INACTIVO';
    if (holder) btn.querySelector('span').textContent = `Traer ESP de ${holder.codigo}`;
  }

  /** Unidad que hoy tiene la clave del ESP: preferentemente la que está en línea. */
  #espHolder(exceptId) {
    const con = vehicle.list.filter((u) => u.tieneClave && u.id !== exceptId);
    return con.find((u) => u.dispositivo) ?? (con.length === 1 ? con[0] : null);
  }

  async #linkEsp() {
    const cur = vehicle.current;
    const holder = cur && this.#espHolder(cur.id);
    if (!holder) return;
    const ok = await confirmDialog('Vincular carrito físico',
      `El ESP8266 que hoy responde como ${holder.codigo} pasará a ${cur.codigo}. ${holder.codigo} se detendrá y quedará sin dispositivo. `
      + 'No hay que cambiar el firmware: el carrito se reconecta solo en unos segundos.', { ok: 'Vincular' });
    if (!ok) return;
    const btn = $('btn-link-esp');
    btn.disabled = true;
    try {
      const r = await Api.transferirDispositivo(holder.id, cur.id);
      toast(r.mensaje || 'Dispositivo vinculado', 'ok', 5000);
      await vehicle.refreshList();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- Unidad activa, presencia del ESP8266, control físico y tiempo de invitado ----------
  #initUnitAndDevices() {
    bus.on('vehicle:changed', (u) => {
      this.releaseAll();
      this.#banner(u ? '' : session.isGuest ? 'Reserva una unidad de exhibición en «Catálogo» para empezar.'
        : session.isUser ? 'Aún no tienes vehículos asignados. Cuando la empresa te asigne uno, aparecerá aquí.'
          : 'No hay una unidad seleccionada. Elige una arriba o regístrala en Administración.');
      this.#device(u?.dispositivo ?? null);
      if (u) this.loadDemos(); else { this.demoList = []; $('demo-select').replaceChildren(new Option('Sin unidad', '')); this.#renderDemo(demos.state, false); }
      this.#syncEnabled();
    });
    bus.on('ws:message', (m) => {
      if (m.tipo === 'dispositivo' && m.conectado !== null) this.#device(m.conectado);
      if (m.tipo === 'estado' && m.dispositivo !== null) this.#device(m.dispositivo);
    });
    bus.on('ws:denied', (d) => {
      if (d.kind !== 'revoked') return;
      this.releaseAll();
      this.#banner(d.code === 4404 ? 'Esta unidad ya no está asignada a tu cuenta.'
        : `Sin permiso sobre esta unidad${d.reason ? `: ${d.reason}` : ''}.`);
    });
    bus.on('ws:status', (s) => { if (s === 'ONLINE') this.#banner(''); });
    bus.on('demos:changed', () => this.loadDemos());

    // Control físico (GameSir / Xbox): mismas reglas que las palancas en pantalla.
    bus.on('view:changed', (v) => gamepad.setEnabled(v === 'control'));
    const padChip = ({ connected, name }) => {
      const chip = $('chip-gamepad');
      chip.dataset.s = connected ? 'ok' : 'none';
      chip.querySelector('span').textContent = connected ? name : 'Sin control';
    };
    padChip(gamepad.info);                              // el control pudo conectarse antes de cargar la vista
    bus.on('gamepad:status', ({ connected, name }) => {
      padChip({ connected, name });
      if (connected) toast(`Control conectado: ${name}`, 'ok');
      else { this.releaseAll(); if (vehicle.current && catalog.loaded) { toast('Control desconectado: vehículo detenido', 'warn'); this.stopAll(); } }
    });
    bus.on('gamepad:dir', ({ stick, dir }) => {
      if ($('view-control').hidden) return;
      this.sticks[stick]?.setExternal(dir);
    });
    bus.on('gamepad:button', ({ action }) => {
      if ($('view-control').hidden) return;
      if (action === 'STOP') { this.stopAll(); return; }
      const btn = this.auxButtons.find((b) => b.dataset.command === action);
      if (btn && !btn.disabled) btn.click();
    });

    // Invitado: tiempo restante de la reserva
    bus.on('reserva:tick', (seg) => {
      const chip = $('chip-guest');
      chip.hidden = seg === null;
      if (seg === null) return;
      const m = Math.floor(seg / 60);
      $('guest-timer').textContent = `${m}:${String(seg % 60).padStart(2, '0')} de prueba`;
      chip.dataset.s = seg <= 30 ? 'bad' : seg <= 60 ? 'wait' : 'ok';
    });
  }

  #device(online) {
    const chip = $('chip-device');
    chip.dataset.s = online === null ? 'none' : online ? 'ok' : 'bad';
    chip.querySelector('span').textContent = online === null ? 'Vehículo físico: sin datos'
      : online ? 'Vehículo físico: en línea' : 'Vehículo físico: sin señal';
  }

  #banner(text) {
    const b = $('control-banner');
    b.hidden = !text;
    b.textContent = text || '';
  }

  /** Suelta ambas palancas (al cambiar de vista, iniciar DEMO o pulsar DETENER). */
  releaseAll() {
    Object.values(this.sticks).forEach((s) => s.release());
  }

  // ---------- Palancas (movimiento continuo mientras se sostienen) ----------
  #initSticks() {
    for (const [owner, cfg] of Object.entries(STICKS)) {
      const statusEl = $(cfg.status);
      const stopRepeat = () => { clearInterval(this.repeatTimers[owner]); this.repeatTimers[owner] = null; };

      const stick = new Joystick($(cfg.el), {
        keys: cfg.keys,
        canStart: () => {
          if (!vehicle.current) { toast('Selecciona una unidad primero', 'warn'); return false; }
          if (!catalog.loaded) { toast('Catálogo de comandos aún no disponible', 'warn'); return false; }
          if (!Object.values(cfg.map).some((c) => catalog.has(c))) { toast('Esta palanca no está disponible para esta unidad o sesión', 'warn'); return false; }
          if (appState.demoRunning) { toast('DEMO en curso: cancélala o pulsa DETENER', 'warn'); return false; }
          if (!commands.claim(owner)) { toast('La otra palanca está en uso', 'warn'); return false; }
          return true;
        },
        onChange: (dir) => {
          stopRepeat();
          if (dir) {
            const name = cfg.map[dir];
            statusEl.textContent = commandLabel(name);
            statusEl.dataset.cmd = name;
            commands.send(name, { source: owner });
            // Mientras la palanca siga en esta dirección, se reafirma el comando (control tipo consola).
            this.repeatTimers[owner] = setInterval(() => commands.send(name, { source: owner, repeat: true }), CONFIG.HOLD_REPEAT_MS);
            return;
          }
          statusEl.textContent = 'Neutral';
          delete statusEl.dataset.cmd;
          delete statusEl.dataset.phase;
          if (dir === null) commands.send(C.STOP, { source: owner });   // regreso al centro => DETENER
          if (!stick.active) commands.release(owner);
        }
      });
      this.sticks[owner] = stick;
    }
  }

  // ---------- DETENER y funciones ----------
  #initButtons() {
    $('btn-stop').addEventListener('click', () => this.stopAll());
    document.addEventListener('keydown', (e) => {
      const typing = e.target.closest?.('input, select, textarea');
      if (typing || $('view-control').hidden) return;
      if (e.key === 'Escape' || (e.key === ' ' && !e.target.closest?.('button, a, .stick'))) {
        e.preventDefault();
        this.stopAll();
      }
    });

    this.auxButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.longPressed) { delete btn.dataset.longPressed; return; }   // fue una corrección manual
        btn.dataset.s = 'sending';
        commands.send(btn.dataset.command, { source: 'button' });
      });
      if (btn.dataset.toggle) this.#initManualFix(btn);
    });
  }

  /**
   * Corrección del indicador ON/OFF sin enviar comando: mantener presionado (táctil o ratón) o clic derecho.
   * Útil si el carrito se reinició o se operó sin la app y el indicador quedó invertido.
   */
  #initManualFix(btn) {
    let timer = null;
    const fix = () => {
      toggles.flip(btn.dataset.toggle);
      const on = toggles.state[btn.dataset.toggle];
      toast(`Indicador de ${commandLabel(btn.dataset.command)} corregido a ${on ? 'ON' : 'OFF'} (no se envió comando)`, 'info');
      navigator.vibrate?.(30);
    };
    btn.addEventListener('pointerdown', (e) => {
      delete btn.dataset.longPressed;
      if (e.button !== 0 || btn.disabled) return;
      timer = setTimeout(() => { timer = null; btn.dataset.longPressed = '1'; fix(); }, LONG_PRESS_MS);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => btn.addEventListener(t, () => { clearTimeout(timer); timer = null; }));
    btn.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!btn.disabled) fix(); });
  }

  /** DETENER: prioridad absoluta. Suelta palancas, cancela la DEMO (si corre) y envía DETENER. */
  stopAll() {
    this.releaseAll();
    const btn = $('btn-stop');
    btn.classList.add('is-firing');
    setTimeout(() => btn.classList.remove('is-firing'), 400);
    if (appState.demoRunning) demos.cancel();       // en paralelo: no retrasa el DETENER
    commands.send(C.STOP, { source: 'stop' });
  }

  #renderToggles(s) {
    this.auxButtons.forEach((b) => {
      const key = b.dataset.toggle;
      if (!key) return;
      const on = Boolean(s[key]);
      b.setAttribute('aria-pressed', String(on));
      b.title = `${catalog.get(b.dataset.command)?.descripcion || commandLabel(b.dataset.command)} · ${on ? 'activo' : 'inactivo'} `
        + '(estado estimado; mantén presionado o clic derecho para corregir el indicador sin enviar comando)';
    });
  }

  #syncEnabled() {
    const owner = commands.owner;
    const demoOn = appState.demoRunning;
    this.auxButtons.forEach((b) => {
      b.disabled = !catalog.has(b.dataset.command) || demoOn || Boolean(owner);
    });
    for (const [name, stick] of Object.entries(this.sticks)) {
      const sinComandos = !Object.values(STICKS[name].map).some((c) => catalog.has(c));
      const blocked = demoOn || !catalog.loaded || sinComandos || (owner && owner !== name);
      stick.el.classList.toggle('is-locked', Boolean(blocked));
      stick.el.setAttribute('aria-disabled', String(Boolean(blocked)));
    }
    $('btn-stop').disabled = !catalog.has(C.STOP);
    this.#renderToggles(toggles.state);
  }

  // ---------- Retroalimentación: solicitado → aceptado API → evento WSS ----------
  #initFeedback() {
    bus.on('cmd:trace', (t) => {
      if (t.phase === 'blocked') { toast(t.msg, 'warn'); this.#markAux(t.name, ''); return; }

      // Punto de fase junto al estado de la palanca que está enviando ese comando
      document.querySelectorAll(`.stick-status[data-cmd="${CSS.escape(t.name)}"]`).forEach((el) => {
        if (!PHASE_TEXT[t.phase]) return;
        if (t.phase === 'accepted' && el.dataset.phase === 'event') return;   // el evento WSS puede llegar antes que el HTTP 201
        el.dataset.phase = t.phase;
        el.title = `${commandLabel(t.name)}: ${PHASE_TEXT[t.phase]}`;
      });

      if (t.phase === 'requested') this.#markAux(t.name, 'sending', false);
      else if (t.phase === 'accepted' || t.phase === 'event') this.#markAux(t.name, '');
      else if (t.phase === 'error') {
        toast(`${commandLabel(t.name)}: ${t.msg}`, 'error');
        this.#markAux(t.name, 'error');
      }
    });
  }

  #markAux(name, state, autoClear = true) {
    const btn = this.auxButtons.find((b) => b.dataset.command === name);
    if (!btn) return;
    btn.dataset.s = state;
    if (state && autoClear) setTimeout(() => { if (btn.dataset.s === state) btn.dataset.s = ''; }, 1500);
  }

  // ---------- DEMO ----------
  #initDemo() {
    const select = $('demo-select');
    select.addEventListener('change', () => this.#renderDemo(demos.state, false));
    $('btn-demo-start').addEventListener('click', () => {
      const demo = this.demoList.find((d) => String(d.id) === select.value);
      if (demo) { this.releaseAll(); demos.start(demo); }
    });
    $('btn-demo-cancel').addEventListener('click', async () => {
      const ok = await demos.cancel();
      if (ok) commands.send(C.STOP, { source: 'stop' });
    });
    bus.on('demo:state', (s) => { this.#renderDemo(s, true); this.#syncEnabled(); });
  }

  async loadDemos() {
    const select = $('demo-select');
    const forVehicle = vehicle.current?.id;
    if (!forVehicle) return;
    try {
      const list = (await Api.demos()).filter((d) => d.activo);
      if (forVehicle !== vehicle.current?.id) return;          // respuesta de una unidad anterior
      this.demoList = list;
      const opts = this.demoList.length
        ? [new Option('Selecciona una DEMO…', ''), ...this.demoList.map((d) => new Option(`${d.nombre}${d.tipo === 'PRIVADA' ? ' · mía' : ''}`, String(d.id)))]
        : [new Option('No hay DEMO registradas', '')];
      select.replaceChildren(...opts);                  // Option() usa texto plano: sin inyección HTML
      if (this.demoList.length === 1) select.value = String(this.demoList[0].id);
    } catch (e) {
      select.replaceChildren(new Option('No se pudieron cargar', ''));
      toast(`DEMO: ${e.message}`, 'error');
    }
    this.#renderDemo(demos.state, false);
  }

  #renderDemo(s, notify) {
    const running = ['starting', 'running', 'cancelling'].includes(s.phase);
    const select = $('demo-select');
    select.disabled = running || !this.demoList.length;
    $('btn-demo-start').disabled = running || !select.value;
    $('btn-demo-cancel').disabled = !running || s.phase === 'cancelling';

    const labels = { idle: 'Lista', starting: 'Iniciando', running: 'En curso', cancelling: 'Cancelando',
      done: 'Finalizada', cancelled: 'Cancelada', error: 'Error', unknown: 'Desconocido' };
    const tag = $('demo-phase');
    tag.textContent = s.total && running ? `Paso ${s.orden}/${s.total}` : (labels[s.phase] ?? s.phase);
    tag.dataset.s = s.phase;

    const pct = s.total ? Math.min(100, Math.round((s.orden / s.total) * 100)) : (running ? 4 : 0);
    $('demo-bar').style.width = `${s.phase === 'done' ? 100 : pct}%`;
    $('demo-bar').parentElement.dataset.s = s.phase;
    $('demo-msg').textContent = s.message || 'Elige una DEMO almacenada.';
    if (notify && ['done', 'cancelled', 'error', 'unknown'].includes(s.phase)) {
      toast(s.message, s.phase === 'done' ? 'ok' : s.phase === 'cancelled' ? 'info' : 'error');
    }
  }
}
