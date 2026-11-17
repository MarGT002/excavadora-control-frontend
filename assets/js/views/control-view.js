import { CONFIG } from '../config.js';
import { bus, appState } from '../core/store.js';
import { catalog } from '../core/catalog.js';
import { commands } from '../core/command-service.js';
import { demos } from '../core/demo-service.js';
import { Api } from '../services/api.js';
import { Joystick } from '../ui/joystick.js';
import { toast } from '../ui/toast.js';
import { commandLabel, commandIcon, formatTime, parseDate } from '../utils/format.js';

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

export class ControlView {
  constructor() {
    this.sticks = {};
    this.auxButtons = [...document.querySelectorAll('.btn-aux')];
    this.demoList = [];
    this.lastSeq = 0;
    this.#initSticks();
    this.#initButtons();
    this.#initDemo();
    this.#initTrace();
    this.#initWsLog();
    bus.on('catalog:loaded', () => this.#syncEnabled());
    bus.on('cmd:owner', () => this.#syncEnabled());
  }

  /** Suelta ambas palancas (al cambiar de vista o perder el foco). */
  releaseAll() {
    Object.values(this.sticks).forEach((s) => s.release());
  }

  // ---------- Palancas ----------
  #initSticks() {
    for (const [owner, cfg] of Object.entries(STICKS)) {
      const statusEl = $(cfg.status);
      const stick = new Joystick($(cfg.el), {
        keys: cfg.keys,
        canStart: () => {
          if (!catalog.loaded) { toast('Catálogo de comandos aún no disponible', 'warn'); return false; }
          if (appState.demoRunning) { toast('DEMO en curso: cancélala o pulsa DETENER', 'warn'); return false; }
          if (!commands.claim(owner)) { toast('La otra palanca está en uso', 'warn'); return false; }
          return true;
        },
        onChange: (dir) => {
          if (dir) {
            const name = cfg.map[dir];
            statusEl.textContent = commandLabel(name);
            commands.send(name, { source: owner });
            return;
          }
          statusEl.textContent = 'Neutral';
          if (dir === null) commands.send(C.STOP, { source: owner });   // regreso al centro => DETENER
          if (!stick.active) commands.release(owner);
        }
      });
      this.sticks[owner] = stick;
    }
  }

  // ---------- DETENER y botones ----------
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
        const name = btn.dataset.command;
        btn.dataset.s = 'sending';
        commands.send(name, { source: 'button' });
      });
    });
  }

  /** DETENER: prioridad absoluta. Cancela la DEMO (si corre) y envía DETENER. */
  async stopAll() {
    this.releaseAll();
    const btn = $('btn-stop');
    btn.classList.add('is-firing');
    setTimeout(() => btn.classList.remove('is-firing'), 400);
    if (appState.demoRunning) demos.cancel();       // en paralelo: no retrasa el DETENER
    commands.send(C.STOP, { source: 'stop' });
  }

  #syncEnabled() {
    const owner = commands.owner;
    const demoOn = appState.demoRunning;
    this.auxButtons.forEach((b) => {
      b.disabled = !catalog.has(b.dataset.command) || demoOn || Boolean(owner);
      b.title = catalog.get(b.dataset.command)?.descripcion || '';
    });
    for (const [name, stick] of Object.entries(this.sticks)) {
      const blocked = demoOn || !catalog.loaded || (owner && owner !== name);
      stick.el.classList.toggle('is-locked', Boolean(blocked));
      stick.el.setAttribute('aria-disabled', String(Boolean(blocked)));
    }
    $('btn-stop').disabled = !catalog.has(C.STOP);
  }

  // ---------- Trazabilidad ----------
  #initTrace() {
    const steps = { requested: $('step-requested'), accepted: $('step-accepted'), event: $('step-event') };
    const setStep = (k, s) => { steps[k].dataset.s = s; };

    bus.on('cmd:trace', (t) => {
      if (t.phase === 'blocked') { toast(t.msg, 'warn'); this.#markAux(t.name, ''); return; }
      if (t.seq < this.lastSeq) return;        // ignora fases de acciones ya superadas
      if (t.phase === 'requested') {
        this.lastSeq = t.seq;
        $('trace-cmd').textContent = commandLabel(t.name);
        $('trace-icon').className = `bi ${commandIcon(t.name)} trace-icon`;
        $('trace-icon').closest('.trace').dataset.cmd = t.name === C.STOP ? 'stop' : '';
        setStep('requested', 'active'); setStep('accepted', 'pending'); setStep('event', 'pending');
        $('trace-msg').textContent = 'Solicitud enviada a la API…';
      }
      if (t.seq !== this.lastSeq) return;
      if (t.phase === 'accepted') {
        setStep('requested', 'done'); setStep('accepted', 'done');
        if (steps.event.dataset.s !== 'done') setStep('event', 'active');
        $('trace-msg').textContent = 'HTTP 201: registrado por la API. No confirma movimiento físico.';
        this.#markAux(t.name, 'ok');
      } else if (t.phase === 'event') {
        setStep('requested', 'done'); setStep('event', 'done');
        $('trace-msg').textContent = `Evento WSS «movimiento» recibido ${t.at ? `(${formatTime(parseDate(t.at))})` : ''}.`;
      } else if (t.phase === 'error') {
        setStep('accepted', 'error'); setStep('event', '');
        $('trace-msg').textContent = `Error: ${t.msg}`;
        toast(`${commandLabel(t.name)}: ${t.msg}`, 'error');
        this.#markAux(t.name, 'error');
      } else if (t.phase === 'superseded') {
        setStep('accepted', 'done');
        $('trace-msg').textContent = 'Respuesta tardía ignorada: DETENER tiene prioridad.';
      }
    });
  }

  #markAux(name, state) {
    const btn = this.auxButtons.find((b) => b.dataset.command === name);
    if (!btn) return;
    btn.dataset.s = state;
    if (state) setTimeout(() => { if (btn.dataset.s === state) btn.dataset.s = ''; }, 1200);
  }

  // ---------- DEMO ----------
  #initDemo() {
    const select = $('demo-select');
    const start = $('btn-demo-start');
    const cancel = $('btn-demo-cancel');

    select.addEventListener('change', () => this.#renderDemo(demos.state));
    start.addEventListener('click', () => {
      const demo = this.demoList.find((d) => String(d.id) === select.value);
      if (demo) { this.releaseAll(); demos.start(demo); }
    });
    cancel.addEventListener('click', async () => {
      const ok = await demos.cancel();
      if (ok) commands.send(C.STOP, { source: 'stop' });
    });
    bus.on('demo:state', (s) => { this.#renderDemo(s); this.#syncEnabled(); });
  }

  async loadDemos() {
    const select = $('demo-select');
    try {
      this.demoList = (await Api.demos()).filter((d) => d.activo);
      const opts = this.demoList.length
        ? [new Option('Selecciona una DEMO…', ''), ...this.demoList.map((d) => new Option(d.nombre, String(d.id)))]
        : [new Option('No hay DEMO registradas', '')];
      select.replaceChildren(...opts);                  // Option() usa texto plano: sin inyección HTML
      if (this.demoList.length === 1) select.value = String(this.demoList[0].id);
    } catch (e) {
      select.replaceChildren(new Option('No se pudieron cargar las DEMO', ''));
      toast(`DEMO: ${e.message}`, 'error');
    }
    this.#renderDemo(demos.state);
  }

  #renderDemo(s) {
    const running = ['starting', 'running', 'cancelling'].includes(s.phase);
    const select = $('demo-select');
    select.disabled = running || !this.demoList.length;
    $('btn-demo-start').disabled = running || !select.value;
    $('btn-demo-cancel').disabled = !running || s.phase === 'cancelling';

    const labels = { idle: 'Lista', starting: 'Iniciando', running: 'En ejecución', cancelling: 'Cancelando',
      done: 'Finalizada', cancelled: 'Cancelada', error: 'Error', unknown: 'Desconocido' };
    const tag = $('demo-phase');
    tag.textContent = labels[s.phase] ?? s.phase;
    tag.dataset.s = s.phase;

    const pct = s.total ? Math.min(100, Math.round((s.orden / s.total) * 100)) : (running ? 4 : 0);
    $('demo-bar').style.width = `${['done'].includes(s.phase) ? 100 : pct}%`;
    $('demo-bar').parentElement.dataset.s = s.phase;
    const step = s.total && running ? ` · paso ${s.orden}/${s.total}` : '';
    $('demo-msg').textContent = `${s.nombre ? `${s.nombre}: ` : ''}${s.message || 'Elige una DEMO almacenada.'}${step}`;
    if (['done', 'cancelled', 'error', 'unknown'].includes(s.phase)) {
      toast(s.message, s.phase === 'done' ? 'ok' : s.phase === 'cancelled' ? 'info' : 'error');
    }
  }

  // ---------- Último evento WSS (evidencia) ----------
  #initWsLog() {
    bus.on('ws:message', (m) => {
      $('wslog').textContent = JSON.stringify(m.raw, null, 2);   // textContent: sin inyección
      $('wslog-time').textContent = formatTime(parseDate(m.timestamp) ?? new Date());
    });
  }
}
