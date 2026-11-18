import { Api } from '../services/api.js';
import { commandLabel, commandIcon } from '../utils/format.js';
import { el, icon } from '../utils/dom.js';
import { confirmDialog } from './modal.js';
import { toast } from './toast.js';

const MAX_PASOS = 30;
const MAX_TOTAL_MS = 120000;
const EXCLUIR = new Set(['DEMO']);       // la demo integrada del juguete no se anida en una secuencia

/**
 * Editor de demos (FÁBRICA para Admin, PRIVADA para comprador). Táctil y con teclado:
 * agregar, quitar, reordenar (↑/↓) y editar comando, duración y pausa de cada paso.
 * El servidor vuelve a validar todo (comandos de la unidad, límites del modelo, total, propiedad).
 */
export class DemoEditor {
  /**
   * @param {HTMLElement} host
   * @param {{vehicleId:number, tipo:'FABRICA'|'PRIVADA', canEdit:(demo)=>boolean, onChanged?:()=>void}} opts
   */
  constructor(host, { vehicleId, tipo, canEdit, onChanged }) {
    this.host = host;
    this.vehicleId = vehicleId;
    this.tipo = tipo;
    this.canEdit = canEdit;
    this.onChanged = onChanged || (() => {});
    this.cmds = [];
    this.demos = [];
    this.current = null;     // { id|null, nombre, descripcion, activo, tipo, pasos:[{idComando,duracion,pausa}] }
    this.dirty = false;
  }

  async load(selectId = null) {
    this.host.replaceChildren(el('p', { class: 'muted' }, 'Cargando demos…'));
    try {
      [this.cmds, this.demos] = await Promise.all([Api.comandosDe(this.vehicleId), Api.demos(this.vehicleId)]);
      this.cmds = this.cmds.filter((c) => c.activo && !EXCLUIR.has(c.nombre));
    } catch (e) {
      this.host.replaceChildren(el('p', { class: 'form-error' }, e.message));
      return;
    }
    const pick = this.demos.find((d) => d.id === selectId) ?? this.demos.find((d) => this.canEdit(d)) ?? null;
    if (pick) await this.open(pick.id); else this.render();
  }

  async open(id) {
    try {
      const d = await Api.demo(id);
      this.current = { ...d, pasos: d.pasos.map((p) => ({ idComando: p.idComando, duracion: p.duracion, pausa: p.pausa })) };
      this.dirty = false;
    } catch (e) { toast(e.message, 'error'); }
    this.render();
  }

  newDemo() {
    const first = this.cmds.find((c) => c.nombre !== 'DETENER') ?? this.cmds[0];
    this.current = { id: null, nombre: '', descripcion: '', activo: true, tipo: this.tipo,
      pasos: first ? [{ idComando: first.id, duracion: 1000, pausa: 200 }] : [] };
    this.dirty = true;
    this.render();
    this.host.querySelector('#de-nombre')?.focus();
  }

  // ------------------------------------------------------------------ render
  render() {
    const d = this.current;
    const editable = d ? (d.id === null || this.canEdit(d)) : false;

    const lista = el('div', { class: 'de-list', role: 'listbox', 'aria-label': 'Demos de la unidad' },
      this.demos.length ? this.demos.map((x) => el('button', {
        type: 'button', class: `de-item${d?.id === x.id ? ' is-active' : ''}`, role: 'option', 'aria-selected': String(d?.id === x.id),
        onclick: () => this.#guard(() => this.open(x.id))
      }, icon(x.tipo === 'PRIVADA' ? 'bi-person-fill-lock' : 'bi-building'), el('span', {}, x.nombre),
        el('small', { class: 'tag', dataset: { s: x.tipo === 'PRIVADA' ? 'demo' : 'live' } }, x.tipo === 'PRIVADA' ? 'Privada' : 'Fábrica')))
        : el('p', { class: 'muted' }, 'Aún no hay demos en esta unidad.'),
      el('button', { type: 'button', class: 'btn-ghost w-100', onclick: () => this.#guard(() => this.newDemo()) }, icon('bi-plus-lg'), ' Nueva demo'));

    if (!d) { this.host.replaceChildren(el('div', { class: 'de-wrap' }, lista, el('div', { class: 'de-empty muted' }, 'Selecciona o crea una demo.'))); return; }

    const total = d.pasos.reduce((a, p) => a + Number(p.duracion || 0) + Number(p.pausa || 0), 0);
    const over = total > MAX_TOTAL_MS;

    const head = el('div', { class: 'de-head' },
      el('label', { class: 'field' }, el('span', {}, 'Nombre'),
        el('input', { id: 'de-nombre', type: 'text', maxlength: 80, value: d.nombre, disabled: !editable, required: true,
          oninput: (e) => { d.nombre = e.target.value; this.dirty = true; } })),
      el('label', { class: 'field' }, el('span', {}, 'Descripción'),
        el('input', { type: 'text', maxlength: 255, value: d.descripcion || '', disabled: !editable,
          oninput: (e) => { d.descripcion = e.target.value; this.dirty = true; } })));

    const pasos = el('ol', { class: 'de-steps', 'aria-label': 'Pasos de la demo en orden' },
      d.pasos.map((p, i) => this.#stepRow(p, i, d, editable)));

    const foot = el('div', { class: 'de-foot' },
      el('p', { class: `de-total${over ? ' is-over' : ''}` }, icon('bi-clock'),
        ` ${d.pasos.length} paso(s) · duración total ${(total / 1000).toFixed(1)} s`, over ? ` (máx. ${MAX_TOTAL_MS / 1000} s)` : ''),
      editable ? el('div', { class: 'btn-row' },
        el('button', { type: 'button', class: 'btn-ghost', disabled: d.pasos.length >= MAX_PASOS, onclick: () => this.#add() }, icon('bi-plus-circle'), ' Paso'),
        d.id !== null ? el('button', { type: 'button', class: 'btn-ghost btn-danger-text', onclick: () => this.#delete() }, icon('bi-trash3'), ' Eliminar') : null,
        el('button', { type: 'button', class: 'btn-ghost', onclick: () => (d.id ? this.open(d.id) : this.load()) }, 'Cancelar'),
        el('button', { type: 'button', class: 'btn-primary', disabled: over || !d.pasos.length, onclick: () => this.#save() }, icon('bi-floppy'), ' Guardar'))
        : el('p', { class: 'muted' }, icon('bi-lock'), ' Solo lectura: demo de fábrica administrada por la empresa.'));

    this.host.replaceChildren(el('div', { class: 'de-wrap' }, lista,
      el('div', { class: 'de-editor' }, head, pasos, foot)));
  }

  #stepRow(p, i, d, editable) {
    const opts = this.cmds.map((c) => el('option', { value: c.id, selected: c.id === p.idComando }, commandLabel(c.nombre)));
    const name = this.cmds.find((c) => c.id === p.idComando)?.nombre ?? '';
    const num = (key, label, min, max, step) => el('label', { class: 'de-num' }, el('span', {}, label),
      el('input', { type: 'number', inputmode: 'numeric', min, max, step, value: p[key], disabled: !editable,
        'aria-label': `${label} del paso ${i + 1}`,
        onchange: (e) => { p[key] = Math.max(min, Math.min(max, Math.round(Number(e.target.value) || 0))); this.dirty = true; this.render(); } }));
    return el('li', { class: 'de-step' },
      el('span', { class: 'de-idx', 'aria-hidden': 'true' }, icon(commandIcon(name)), el('b', {}, i + 1)),
      el('label', { class: 'de-cmd' }, el('span', { class: 'visually-hidden' }, `Comando del paso ${i + 1}`),
        el('select', { disabled: !editable, onchange: (e) => { p.idComando = Number(e.target.value); this.dirty = true; this.render(); } }, opts)),
      num('duracion', 'Duración ms', 100, 60000, 100),
      num('pausa', 'Pausa ms', 0, 5000, 100),
      editable ? el('div', { class: 'de-tools' },
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': `Subir paso ${i + 1}`, disabled: i === 0, onclick: () => this.#move(i, -1) }, icon('bi-arrow-up')),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': `Bajar paso ${i + 1}`, disabled: i === d.pasos.length - 1, onclick: () => this.#move(i, 1) }, icon('bi-arrow-down')),
        el('button', { type: 'button', class: 'icon-btn icon-btn--danger', 'aria-label': `Quitar paso ${i + 1}`, onclick: () => this.#remove(i) }, icon('bi-x-lg'))) : null);
  }

  // ------------------------------------------------------------------ acciones
  #add() {
    const last = this.current.pasos.at(-1);
    this.current.pasos.push({ idComando: last?.idComando ?? this.cmds[0]?.id, duracion: last?.duracion ?? 1000, pausa: last?.pausa ?? 200 });
    this.dirty = true;
    this.render();
  }

  #move(i, delta) {
    const a = this.current.pasos;
    [a[i], a[i + delta]] = [a[i + delta], a[i]];
    this.dirty = true;
    this.render();
  }

  #remove(i) {
    this.current.pasos.splice(i, 1);
    this.dirty = true;
    this.render();
  }

  async #save() {
    const d = this.current;
    if (!d.nombre.trim()) { toast('La demo necesita un nombre', 'warn'); this.host.querySelector('#de-nombre')?.focus(); return; }
    try {
      let id = d.id;
      if (id === null) id = (await Api.crearDemo(this.vehicleId, d.nombre.trim(), d.descripcion || null)).id_demo;
      else await Api.actualizarDemo(id, d.nombre.trim(), d.descripcion || null, d.activo);
      await Api.guardarPasos(id, d.pasos);
      this.dirty = false;
      toast('Demo guardada en RDS', 'ok');
      this.onChanged();
      await this.load(id);
    } catch (e) {
      toast(`No se guardó: ${e.message}`, 'error', 5000);
    }
  }

  async #delete() {
    const d = this.current;
    if (!await confirmDialog('Eliminar demo', `¿Eliminar «${d.nombre}» y sus ${d.pasos.length} pasos? El historial de movimientos no se modifica.`, { ok: 'Eliminar', danger: true })) return;
    try {
      await Api.eliminarDemo(d.id);
      toast('Demo eliminada', 'ok');
      this.current = null;
      this.onChanged();
      await this.load();
    } catch (e) { toast(e.message, 'error'); }
  }

  async #guard(fn) {
    if (this.dirty && !await confirmDialog('Cambios sin guardar', 'Hay cambios sin guardar en la demo actual. ¿Descartarlos?', { ok: 'Descartar' })) return;
    this.dirty = false;
    fn();
  }
}
