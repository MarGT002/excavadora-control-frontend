import { CONFIG } from '../config.js';
import { bus, appState } from '../core/store.js';
import { Api } from '../services/api.js';
import { vehicle } from '../core/vehicle.js';
import { toast } from '../ui/toast.js';
import { commandLabel, commandIcon, parseDate, formatDate, formatTime, relativeTime } from '../utils/format.js';

const $ = (id) => document.getElementById(id);

/**
 * MONITOREO:
 *  - Tarjeta del último movimiento/estado: carga inicial por REST (GET /estado) y
 *    actualización inmediata con eventos WSS válidos del mismo vehículo (aunque vengan de otra sesión).
 *  - Tabla de 10 movimientos individuales PERSISTIDOS: siempre desde GET /historial (RDS).
 *    Un evento WSS «movimiento» solo DISPARA la resincronización; los pasos de DEMO no la tocan.
 *  - Control de concurrencia: cada consulta lleva un número de secuencia; una respuesta vieja
 *    nunca sobrescribe datos más nuevos (ni una WSS más reciente).
 */
export class MonitorView {
  constructor() {
    this.last = null;          // { cmd, codigo, date, source }
    this.lastEventAt = 0;      // marca de tiempo (ms) del último dato aplicado a la tarjeta
    this.rows = [];
    this.knownIds = new Set();
    this.firstLoad = true;
    this.estadoSeq = 0;
    this.histSeq = 0;
    this.histCtrl = null;
    this.resyncTimer = null;

    $('btn-resync').addEventListener('click', () => this.refresh());
    bus.on('ws:message', (m) => this.#onWs(m));
    bus.on('ws:reconnected', () => this.refresh());
    bus.on('vehicle:changed', () => { this.reset(); if (!document.getElementById('view-monitoreo').hidden) this.refresh(); });
    bus.on('ws:status', (s) => this.#onWsStatus(s));
    setInterval(() => this.#renderRelative(), 15000);
  }

  /** Carga/resincronización completa por REST (al abrir, al reconectar WSS o manualmente). */
  refresh() {
    if (!vehicle.current) {
      this.#renderLast(null);
      this.#renderMessage('Selecciona una unidad para ver su historial.');
      this.#setTag('hist-status', 'idle', 'Sin unidad');
      return;
    }
    $('last-vehicle').textContent = vehicle.current.nombre || '—';
    this.#loadEstado();
    this.#loadHistorial();
  }

  /** Al cambiar de unidad se descarta todo lo de la anterior (sin mezclar eventos ni filas). */
  reset() {
    this.last = null;
    this.lastEventAt = 0;
    this.rows = [];
    this.knownIds = new Set();
    this.firstLoad = true;
    this.estadoSeq++;
    this.histSeq++;
    this.histCtrl?.abort();
    clearTimeout(this.resyncTimer);
  }

  // ---------- Último movimiento ----------
  async #loadEstado() {
    const seq = ++this.estadoSeq;
    const requestedAt = Date.now();
    this.#setTag('last-source', 'loading', 'Cargando…');
    try {
      const e = await Api.estado();
      if (seq !== this.estadoSeq) return;                         // respuesta obsoleta
      if (this.lastEventAt > requestedAt) { this.#renderLastTag(); return; }   // ya llegó algo más nuevo por WSS
      if (e.vehiculo) $('last-vehicle').textContent = e.vehiculo;
      if (!e.comando) { this.#renderLast(null); return; }
      this.#applyLast({ cmd: e.comando, codigo: e.codigo, date: parseDate(e.fecha), source: 'rest' });
    } catch (err) {
      if (seq !== this.estadoSeq) return;
      this.#setTag('last-source', 'error', 'Error');
      if (!this.last) { $('last-cmd').textContent = 'Sin datos actualizados'; }
      $('last-note').textContent = `No se pudo consultar el estado: ${err.message}. ${this.last ? 'Se muestra el último valor conocido.' : ''}`;
    }
  }

  #applyLast(data) {
    // Evita retrocesos: un dato con fecha anterior al actual no lo reemplaza.
    if (this.last?.date && data.date && data.date < this.last.date && data.source === 'rest') return;
    this.last = data;
    this.lastEventAt = Date.now();
    this.#renderLast(data);
  }

  #renderLast(d) {
    const card = $('last-move');
    if (!d) {
      $('last-cmd').textContent = 'Sin movimientos';
      $('last-code').textContent = '';
      $('last-icon').className = 'bi bi-dash-circle';
      ['last-date', 'last-time', 'last-rel'].forEach((id) => { $(id).textContent = '—'; });
      card.dataset.source = 'none';
      this.#setTag('last-source', 'idle', 'Sin datos');
      return;
    }
    $('last-cmd').textContent = commandLabel(d.cmd);
    $('last-code').textContent = `${d.cmd}${d.codigo !== null && d.codigo !== undefined ? ` · código ${d.codigo}` : ''}`;
    $('last-icon').className = `bi ${commandIcon(d.cmd)}`;
    $('last-date').textContent = formatDate(d.date);
    $('last-time').textContent = formatTime(d.date);
    if (appState.vehicleName) $('last-vehicle').textContent = appState.vehicleName;
    card.dataset.source = d.source;
    card.classList.remove('is-flash'); void card.offsetWidth; card.classList.add('is-flash');
    this.#renderRelative();
    this.#renderLastTag();
    $('last-note').textContent = d.source === 'demo'
      ? 'Paso interno de una DEMO: actualiza el estado pero NO se guarda en el historial individual.'
      : '«Reportado» significa publicado por el backend; no confirma ejecución física.';
  }

  #renderLastTag() {
    const d = this.last;
    if (!d) return;
    const map = { rest: ['rest', 'REST · RDS'], ws: ['live', 'Evento WSS'], demo: ['demo', 'WSS · DEMO'], initial: ['live', 'WSS · inicial'] };
    const [s, text] = map[d.source] ?? ['idle', d.source];
    this.#setTag('last-source', s, text);
  }

  #renderRelative() {
    $('last-rel').textContent = this.last?.date ? relativeTime(this.last.date) : '—';
  }

  // ---------- Eventos WSS ----------
  #onWs(m) {
    const date = parseDate(m.timestamp);
    if (m.tipo === 'movimiento') {
      this.#applyLast({ cmd: m.comando, codigo: m.codigo, date, source: 'ws' });
      this.#scheduleHistorySync();                        // la tabla se reconcilia con RDS
    } else if (m.tipo === 'demo_movimiento') {
      this.#applyLast({ cmd: m.comando, codigo: m.codigo, date, source: 'demo' });   // la tabla NO cambia
    } else if (m.tipo === 'estado' && m.comando && !this.last) {
      this.#applyLast({ cmd: m.comando, codigo: m.codigo, date: null, source: 'initial' });
    }
  }

  #onWsStatus(s) {
    if (s === 'OFFLINE' && this.last) {
      $('last-note').textContent = 'WebSocket desconectado: se muestra el último valor conocido hasta reconectar.';
    }
  }

  #scheduleHistorySync() {
    clearTimeout(this.resyncTimer);
    this.resyncTimer = setTimeout(() => this.#loadHistorial(), CONFIG.RESYNC_DEBOUNCE_MS);
  }

  // ---------- Historial ----------
  async #loadHistorial() {
    const seq = ++this.histSeq;
    this.histCtrl?.abort();                               // cancela la consulta anterior
    this.histCtrl = new AbortController();
    this.#setTag('hist-status', 'loading', 'Sincronizando…');
    try {
      const rows = await Api.historial(this.histCtrl.signal);
      if (seq !== this.histSeq) return;
      this.#renderRows(rows);
      this.#setTag('hist-status', 'rest', `${rows.length}/${CONFIG.HISTORY_LIMIT} · RDS`);
      $('hist-status').title = `Sincronizado con GET /historial a las ${formatTime(new Date())}`;
    } catch (err) {
      if (err.kind === 'abort' || seq !== this.histSeq) return;
      this.#setTag('hist-status', 'error', 'Error');
      if (!this.rows.length) this.#renderMessage(`No se pudo cargar el historial: ${err.message}`);
      else toast(`Historial: ${err.message}. Se conserva la última tabla.`, 'error');
    }
  }

  #renderRows(rows) {
    this.rows = rows;
    if (!rows.length) { this.#renderMessage('Sin movimientos registrados.'); this.knownIds.clear(); return; }
    const frag = document.createDocumentFragment();
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      if (!this.firstLoad && !this.knownIds.has(r.id)) tr.className = 'is-new';
      const d = parseDate(r.fecha);
      const cells = [
        String(i + 1),
        null,
        formatDate(d),
        formatTime(d),
        String(r.id)
      ];
      cells.forEach((text, idx) => {
        const td = document.createElement('td');
        if (idx === 1) {
          const icon = document.createElement('i');
          icon.className = `bi ${commandIcon(r.comando)}`;
          icon.setAttribute('aria-hidden', 'true');
          const span = document.createElement('span');
          span.textContent = commandLabel(r.comando);
          td.append(icon, span);
          td.className = 'cell-cmd';
          td.title = r.comando;
        } else {
          td.textContent = text;
          if (idx >= 2) td.className = idx === 4 ? 'mono col-id' : 'mono';
        }
        tr.append(td);
      });
      frag.append(tr);
    });
    $('hist-body').replaceChildren(frag);
    this.knownIds = new Set(rows.map((r) => r.id));
    this.firstLoad = false;
  }

  #renderMessage(text) {
    const tr = document.createElement('tr');
    tr.className = 'hist-empty';
    const td = document.createElement('td');
    td.colSpan = 5;
    td.textContent = text;
    tr.append(td);
    $('hist-body').replaceChildren(tr);
  }

  #setTag(id, s, text) {
    const el = $(id);
    el.dataset.s = s;
    el.textContent = text;
  }
}
