import { bus } from '../core/store.js';
import { session } from '../core/session.js';
import { vehicle } from '../core/vehicle.js';
import { Api } from '../services/api.js';
import { DemoEditor } from '../ui/demo-editor.js';
import { confirmDialog, formDialog, infoDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { commandLabel, formatDate, formatTime, parseDate } from '../utils/format.js';
import { el, icon } from '../utils/dom.js';
import { go } from './router.js';

const $ = (id) => document.getElementById(id);
const ESTADOS = { DISPONIBLE: ['Disponible', 'rest'], VENDIDO: ['Vendida', 'live'], EXHIBICION: ['Exhibición', 'demo'], INACTIVO: ['Inactiva', 'idle'] };
const tag = (estado) => el('span', { class: 'tag', dataset: { s: ESTADOS[estado]?.[1] ?? 'idle' } }, ESTADOS[estado]?.[0] ?? estado);
const fecha = (v) => { const d = parseDate(v); return d ? `${formatDate(d)} ${formatTime(d)}` : '—'; };

/**
 * ADMINISTRACIÓN (Admin) / MI CUENTA (Usuario). Solo dibuja lo que el rol puede usar;
 * cada operación vuelve a autorizarse en FastAPI (403/404 si no corresponde).
 */
export class AdminView {
  constructor() {
    this.tab = null;
    bus.on('view:changed', (v) => { if (v === 'admin') this.#renderTabs(); });
    bus.on('session:changed', () => { this.tab = null; });
  }

  #tabs() {
    if (session.isAdmin) return [['panel', 'Panel', 'bi-speedometer2'], ['unidades', 'Unidades', 'bi-truck'], ['modelos', 'Modelos', 'bi-box-seam'],
      ['clientes', 'Clientes', 'bi-people'], ['demos', 'Demos', 'bi-collection-play'], ['auditoria', 'Auditoría', 'bi-shield-check']];
    if (session.isUser) return [['mis', 'Mis vehículos', 'bi-truck'], ['misdemos', 'Mis demos', 'bi-collection-play']];
    return [];
  }

  #renderTabs() {
    const tabs = this.#tabs();
    if (!tabs.length) { $('admin-body').replaceChildren(el('p', { class: 'muted' }, 'Sin acceso.')); return; }
    if (!tabs.some(([k]) => k === this.tab)) this.tab = tabs[0][0];
    $('admin-tabs').replaceChildren(...tabs.map(([k, label, ic]) => el('button', {
      type: 'button', role: 'tab', class: 'admin-tab', 'aria-selected': String(k === this.tab), id: `tab-${k}`,
      onclick: () => { this.tab = k; this.#renderTabs(); }
    }, icon(ic), el('span', {}, label))));
    const body = $('admin-body');
    body.setAttribute('aria-labelledby', `tab-${this.tab}`);
    body.replaceChildren(el('p', { class: 'muted' }, 'Cargando…'));
    ({ panel: () => this.#panel(), unidades: () => this.#unidades(), modelos: () => this.#modelos(), clientes: () => this.#clientes(),
      demos: () => this.#demos(), auditoria: () => this.#auditoria(), mis: () => this.#mis(), misdemos: () => this.#misDemos() })[this.tab]()
      .catch((e) => body.replaceChildren(el('p', { class: 'form-error' }, e.message)));
  }

  #body(...nodes) { $('admin-body').replaceChildren(...nodes); }

  // ================================================================ ADMIN · Panel
  async #panel() {
    const d = await Api.dashboard();
    const m = d.metricas || {};
    const tiles = [
      ['Modelos', m.modelos, 'bi-box-seam'], ['Unidades', m.total, 'bi-truck'], ['Disponibles', m.disponibles, 'bi-check2-circle'],
      ['Vendidas', m.vendidas, 'bi-bag-check'], ['Exhibición', m.exhibicion, 'bi-stars'], ['Inactivas', m.inactivas, 'bi-slash-circle'],
      ['Clientes', m.clientes, 'bi-people'], ['Demos fábrica', m.demos_fabrica, 'bi-building'], ['Demos privadas', m.demos_privadas, 'bi-person-lock'],
      ['Pruebas activas', m.reservas_activas, 'bi-hourglass-split'], ['ESP en línea', m.dispositivos_en_linea, 'bi-cpu'], ['Denegados 24 h', m.denegados_24h, 'bi-shield-exclamation']
    ];
    this.#body(
      el('div', { class: 'tiles' }, tiles.map(([l, v, ic]) => el('div', { class: 'tile' }, icon(ic), el('b', {}, v ?? 'Sin datos'), el('span', {}, l)))),
      el('div', { class: 'admin-cols' },
        el('section', { class: 'panel' }, el('h3', { class: 'panel-title' }, icon('bi-clock-history'), ' Unidades recientes'),
          this.#unitTable(d.unidades_recientes?.map((u) => ({ id: u.id_vehiculo, codigo: u.codigo_unidad, modelo: u.modelo_nombre, estado: u.estado_comercial,
            propietario: u.propietario_nombre, dispositivo: u.dispositivo_en_linea })) ?? [], false)),
        el('section', { class: 'panel' }, el('h3', { class: 'panel-title' }, icon('bi-stars'), ' Exhibición ahora'),
          d.exhibicion?.length ? el('ul', { class: 'plain-list' }, d.exhibicion.map((e) => el('li', {},
            el('span', { class: 'mono' }, e.codigo_unidad), ` ${e.modelo} · `, e.disponible ? el('b', { class: 'ok' }, 'libre') : el('b', { class: 'busy' }, `en prueba (${Math.ceil((e.ocupada_seg || 0) / 60)} min)`))))
            : el('p', { class: 'muted' }, 'Sin unidades en exhibición.'))));
  }

  // ================================================================ ADMIN · Unidades
  async #unidades(filtros = this.filtros || {}) {
    this.filtros = filtros;
    const [unidades, modelos, clientes] = await Promise.all([Api.unidades(filtros), Api.modelos(), Api.clientes()]);
    this.modelosCache = modelos;
    this.clientesCache = clientes;
    this.unidadesCache = unidades;
    const q = el('input', { type: 'search', placeholder: 'Buscar código, cliente…', value: filtros.q || '', 'aria-label': 'Buscar unidad', maxlength: 60 });
    const est = el('select', { 'aria-label': 'Filtrar por estado' }, el('option', { value: '' }, 'Todos los estados'),
      Object.entries(ESTADOS).map(([k, [l]]) => el('option', { value: k, selected: filtros.estado === k }, l)));
    const apply = () => this.#unidades({ q: q.value.trim(), estado: est.value }).catch((e) => toast(e.message, 'error'));
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
    est.addEventListener('change', apply);
    this.#body(
      el('div', { class: 'toolbar' }, q, est,
        el('button', { type: 'button', class: 'btn-ghost', onclick: apply }, icon('bi-search'), ' Buscar'),
        el('button', { type: 'button', class: 'btn-primary', onclick: () => this.#nuevaUnidad() }, icon('bi-plus-lg'), ' Nueva unidad')),
      this.#unitTable(unidades, true));
  }

  #unitTable(rows, actions) {
    if (!rows.length) return el('p', { class: 'muted' }, 'Sin unidades.');
    return el('div', { class: 'table-wrap' }, el('table', { class: 'data-table' },
      el('thead', {}, el('tr', {}, ['Código', 'Modelo', 'Estado', 'Propietario', 'ESP', ...(actions ? ['Acciones'] : [])].map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, rows.map((u) => el('tr', {},
        el('td', { class: 'mono' }, u.codigo), el('td', {}, u.modelo || '—'), el('td', {}, tag(u.estado)),
        el('td', {}, u.propietario || el('span', { class: 'muted' }, '—')),
        el('td', {}, el('span', { class: `dot ${u.dispositivo ? 'dot--ok' : ''}`, title: u.dispositivo ? 'ESP8266 en línea' : 'Sin señal del dispositivo' }),
          el('span', { class: 'visually-hidden' }, u.dispositivo ? 'en línea' : 'sin señal')),
        actions ? el('td', { class: 'row-actions' }, this.#unitActions(u)) : null)))));
  }

  #unitActions(u) {
    const b = (label, ic, fn, extra = {}) => el('button', { type: 'button', class: 'btn-sm btn-ghost', onclick: fn, ...extra }, icon(ic), ` ${label}`);
    return [
      u.estado !== 'VENDIDO' && u.estado !== 'INACTIVO' ? b('Asignar', 'bi-person-plus', () => this.#asignar(u)) : null,
      u.estado === 'VENDIDO' ? b('Reasignar', 'bi-arrow-left-right', () => this.#asignar(u)) : null,
      u.estado !== 'DISPONIBLE' ? b(u.estado === 'INACTIVO' ? 'Reactivar' : 'Liberar', 'bi-box-arrow-left', () => this.#liberar(u)) : null,
      b('Editar', 'bi-pencil', () => this.#editarUnidad(u)),
      b('Clave ESP', 'bi-key', () => this.#clave(u)),
      u.tieneClave ? b('Mover ESP', 'bi-link-45deg', () => this.#moverEsp(u), { title: 'Vincular este ESP8266 a otra unidad sin cambiar el firmware' }) : null,
      u.estado !== 'VENDIDO' && u.estado !== 'INACTIVO' ? b('Operar', 'bi-controller', () => { vehicle.select(u.id); go('control'); }) : null
    ];
  }

  async #nuevaUnidad() {
    const modelos = (this.modelosCache || []).filter((m) => m.activo);
    if (!modelos.length) { toast('Primero registra un modelo con capacidades', 'warn'); return; }
    const r = await formDialog('Nueva unidad física', [
      { name: 'id_modelo', label: 'Modelo comercial', type: 'select', options: modelos.map((m) => ({ value: m.id_modelo, label: m.nombre })) },
      { name: 'codigo_unidad', label: 'Identificador único', required: true, maxlength: 40, pattern: '[A-Za-z0-9_\\-]{3,40}', help: 'Ej. EXC-0002 (letras, números, guion)' },
      { name: 'descripcion', label: 'Descripción', type: 'textarea' },
      { name: 'estado_comercial', label: 'Estado inicial', type: 'select', options: [{ value: 'DISPONIBLE', label: 'Disponible (inventario)' }, { value: 'EXHIBICION', label: 'Exhibición (pruebas públicas)' }] }
    ], { submit: 'Registrar', onSubmit: (v) => Api.crearUnidad({ ...v, id_modelo: Number(v.id_modelo), descripcion: v.descripcion || null }) });
    if (r) { toast(`Unidad ${r.codigo_unidad} registrada con los comandos del modelo`, 'ok'); this.#afterUnitChange(); }
  }

  async #editarUnidad(u) {
    const opts = ['DISPONIBLE', 'EXHIBICION', 'INACTIVO'];
    const r = await formDialog(`Editar ${u.codigo}`, [
      { name: 'codigo_unidad', label: 'Identificador único', value: u.codigo, required: true, maxlength: 40, pattern: '[A-Za-z0-9_\\-]{3,40}' },
      ...(u.estado === 'VENDIDO' ? [] : [{ name: 'estado_comercial', label: 'Estado', type: 'select', value: u.estado,
        options: opts.map((k) => ({ value: k, label: ESTADOS[k][0] })) }])
    ], { onSubmit: (v) => Api.actualizarUnidad(u.id, v) });
    if (r) { toast('Unidad actualizada', 'ok'); this.#afterUnitChange(); }
  }

  async #asignar(u) {
    const clientes = (this.clientesCache || []).filter((c) => c.activo);
    if (!clientes.length) { toast('Da de alta un cliente primero', 'warn'); return; }
    const r = await formDialog(`Asignar ${u.codigo} a un comprador`, [
      { name: 'id_usuario', label: 'Comprador', type: 'select', options: clientes.map((c) => ({ value: c.id_usuario, label: `${c.nombre} · ${c.email}` })) }
    ], { submit: 'Asignar', onSubmit: (v) => Api.asignar(u.id, v.id_usuario) });
    if (r) { toast(`${u.codigo} asignada a ${r.propietario_nombre}. El titular anterior perdió el acceso.`, 'ok', 5000); this.#afterUnitChange(); }
  }

  async #liberar(u) {
    const r = await formDialog(`Recuperar ${u.codigo}`, [
      { name: 'estado', label: 'Nuevo estado', type: 'select', value: 'DISPONIBLE',
        options: ['DISPONIBLE', 'EXHIBICION', 'INACTIVO'].map((k) => ({ value: k, label: ESTADOS[k][0] })) }
    ], { submit: 'Aplicar', onSubmit: (v) => Api.liberar(u.id, v.estado) });
    if (r) { toast('Estado actualizado; la unidad se detuvo y se revocaron accesos', 'ok'); this.#afterUnitChange(); }
  }

  async #clave(u) {
    if (!await confirmDialog('Clave del dispositivo', `Se generará una clave nueva para ${u.codigo}. La anterior dejará de funcionar y el ESP8266 deberá actualizarse.`, { ok: 'Generar' })) return;
    try {
      const r = await Api.claveDispositivo(u.id);
      const code = el('code', { class: 'secret' }, r.clave_dispositivo);
      await infoDialog('Clave generada', [
        el('p', {}, 'Cópiala en ', el('code', {}, 'credenciales.h'), ' del firmware. ', el('b', {}, 'Solo se muestra esta vez'), '; la base de datos guarda únicamente su hash.'),
        el('p', {}, 'Unidad: ', el('code', {}, r.codigo_unidad)), code,
        el('button', { type: 'button', class: 'btn-ghost btn-sm', onclick: () => navigator.clipboard?.writeText(r.clave_dispositivo).then(() => toast('Copiada', 'ok')) }, icon('bi-clipboard'), ' Copiar')]);
    } catch (e) { toast(e.message, 'error'); }
  }

  async #moverEsp(u) {
    const destinos = (this.unidadesCache || vehicle.list).filter((x) => x.id !== u.id && x.estado !== 'INACTIVO');
    if (!destinos.length) { toast('No hay otra unidad activa a la cual mover el dispositivo', 'warn'); return; }
    const r = await formDialog(`Mover el ESP8266 de ${u.codigo}`, [
      { name: 'id_destino', label: 'Unidad destino', type: 'select',
        options: destinos.map((x) => ({ value: x.id, label: `${x.codigo} · ${x.modelo || x.nombre} · ${ESTADOS[x.estado]?.[0] ?? x.estado}` })),
        help: `${u.codigo} se detendrá y quedará sin dispositivo. El carrito se reconecta solo (misma clave, sin recompilar).` }
    ], { submit: 'Mover', onSubmit: (v) => Api.transferirDispositivo(u.id, v.id_destino) });
    if (r) { toast(r.mensaje || 'Dispositivo vinculado', 'ok', 5000); this.#afterUnitChange(); }
  }

  async #afterUnitChange() {
    await this.#unidades().catch((e) => toast(e.message, 'error'));
    vehicle.loadForSession().catch(() => {});
  }

  // ================================================================ ADMIN · Modelos
  async #modelos() {
    const modelos = await Api.modelos();
    this.#body(
      el('div', { class: 'toolbar' }, el('button', { type: 'button', class: 'btn-primary', onclick: () => this.#nuevoModelo(modelos) }, icon('bi-plus-lg'), ' Nuevo modelo')),
      el('div', { class: 'card-grid' }, modelos.map((m) => el('article', { class: 'panel model-admin' },
        el('div', { class: 'panel-head' }, el('h3', { class: 'panel-title' }, icon('bi-box-seam'), ` ${m.nombre}`),
          el('span', { class: 'tag', dataset: { s: m.activo ? 'rest' : 'idle' } }, m.activo ? 'Activo' : 'Inactivo')),
        el('p', { class: 'muted' }, m.descripcion || 'Sin descripción'),
        el('p', {}, el('b', {}, m.unidades), ' unidades · ', el('b', {}, m.en_exhibicion), ' en exhibición · ', m.microcontrolador || '—'),
        el('ul', { class: 'cap-list' }, (m.capacidades || []).map((c) => el('li', { class: c.permitido_invitado ? 'is-demo' : '', title: `máx. ${c.max_duracion_ms} ms por paso` },
          `${commandLabel(c.nombre)} · ${c.codigo}`))),
        el('p', { class: 'note' }, 'Resaltadas: disponibles para Invitado. Las capacidades definen los comandos que se copian a cada unidad nueva.'),
        el('div', { class: 'btn-row' }, el('button', { type: 'button', class: 'btn-ghost btn-sm', onclick: () => this.#editarModelo(m) }, icon('bi-pencil'), ' Editar'))))));
  }

  async #nuevoModelo(modelos) {
    const base = modelos.find((m) => m.capacidades?.length);
    const r = await formDialog('Nuevo modelo comercial', [
      { name: 'nombre', label: 'Nombre', required: true, maxlength: 80, help: 'Ej. Vehículo Batman IoT' },
      { name: 'descripcion', label: 'Descripción', type: 'textarea' },
      { name: 'microcontrolador', label: 'Microcontrolador', maxlength: 50, value: 'ESP8266' },
      { name: 'base', label: 'Capacidades (hardware)', type: 'select', value: base?.id_modelo ?? '',
        options: [...modelos.filter((m) => m.capacidades?.length).map((m) => ({ value: m.id_modelo, label: `Copiar de ${m.nombre}` })),
          { value: '', label: 'Solo DETENER (las agregas después)' }] }
    ], {
      submit: 'Crear', onSubmit: (v) => {
        const src = modelos.find((m) => String(m.id_modelo) === v.base);
        const caps = src ? src.capacidades.map((c) => ({ nombre: c.nombre, codigo: c.codigo, descripcion: c.descripcion,
          permitido_invitado: Boolean(c.permitido_invitado), max_duracion_ms: c.max_duracion_ms }))
          : [{ nombre: 'DETENER', codigo: 9, descripcion: 'Detener cualquier movimiento', permitido_invitado: true, max_duracion_ms: 1000 }];
        return Api.crearModelo({ nombre: v.nombre, descripcion: v.descripcion || null, microcontrolador: v.microcontrolador || null, capacidades: caps });
      }
    });
    if (r) { toast(`Modelo ${r.nombre} creado`, 'ok'); this.#modelos(); }
  }

  async #editarModelo(m) {
    const r = await formDialog(`Editar ${m.nombre}`, [
      { name: 'nombre', label: 'Nombre', value: m.nombre, required: true, maxlength: 80 },
      { name: 'descripcion', label: 'Descripción', type: 'textarea', value: m.descripcion || '' },
      { name: 'microcontrolador', label: 'Microcontrolador', value: m.microcontrolador || '', maxlength: 50 },
      { name: 'activo', label: 'Activo en el catálogo', type: 'checkbox', value: m.activo }
    ], { onSubmit: (v) => Api.actualizarModelo(m.id_modelo, { ...v, descripcion: v.descripcion || null, microcontrolador: v.microcontrolador || null, imagen_url: m.imagen_url }) });
    if (r) { toast('Modelo actualizado', 'ok'); this.#modelos(); }
  }

  // ================================================================ ADMIN · Clientes
  async #clientes(q = '') {
    const clientes = await Api.clientes(q);
    const search = el('input', { type: 'search', placeholder: 'Buscar nombre o correo', value: q, 'aria-label': 'Buscar cliente', maxlength: 60 });
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.#clientes(search.value.trim()).catch((er) => toast(er.message, 'error')); });
    this.#body(
      el('div', { class: 'toolbar' }, search,
        el('button', { type: 'button', class: 'btn-primary', onclick: () => this.#nuevoCliente() }, icon('bi-person-plus'), ' Nuevo cliente')),
      clientes.length ? el('div', { class: 'table-wrap' }, el('table', { class: 'data-table' },
        el('thead', {}, el('tr', {}, ['Nombre', 'Correo', 'Teléfono', 'Unidades', 'Estado', 'Acciones'].map((h) => el('th', { scope: 'col' }, h)))),
        el('tbody', {}, clientes.map((c) => el('tr', {},
          el('td', {}, c.nombre, c.email_verificado === 0 ? el('small', { class: 'tag tag--mini', dataset: { s: 'running' }, title: 'Se registró pero aún no confirma su correo' }, 'sin verificar') : null),
          el('td', { class: 'mono' }, c.email), el('td', {}, c.telefono || '—'), el('td', {}, String(c.unidades ?? 0)),
          el('td', {}, el('span', { class: 'tag', dataset: { s: c.activo ? 'rest' : 'error' } }, c.activo ? 'Activo' : 'Desactivado')),
          el('td', { class: 'row-actions' },
            el('button', { type: 'button', class: 'btn-sm btn-ghost', onclick: () => this.#editarCliente(c) }, icon('bi-pencil'), ' Editar'),
            el('button', { type: 'button', class: `btn-sm btn-ghost${c.activo ? ' btn-danger-text' : ''}`, onclick: () => this.#toggleCliente(c) },
              icon(c.activo ? 'bi-person-x' : 'bi-person-check'), c.activo ? ' Desactivar' : ' Activar')))))))
        : el('p', { class: 'muted' }, 'Sin clientes registrados.'));
  }

  async #nuevoCliente() {
    const r = await formDialog('Alta de comprador', [
      { name: 'nombre', label: 'Nombre completo', required: true, maxlength: 100 },
      { name: 'email', label: 'Correo', type: 'email', required: true, maxlength: 120 },
      { name: 'telefono', label: 'Teléfono', maxlength: 30, type: 'tel' },
      { name: 'password', label: 'Contraseña inicial', type: 'password', required: true, help: 'Mínimo 8 caracteres. Compártela por un canal seguro.', autocomplete: 'new-password' }
    ], { submit: 'Crear', onSubmit: (v) => Api.crearCliente({ ...v, telefono: v.telefono || null }) });
    if (r) { toast(`Cliente ${r.email} creado`, 'ok'); this.#clientes(); }
  }

  async #editarCliente(c) {
    const r = await formDialog(`Editar ${c.nombre}`, [
      { name: 'nombre', label: 'Nombre', value: c.nombre, required: true, maxlength: 100 },
      { name: 'telefono', label: 'Teléfono', value: c.telefono || '', maxlength: 30 }
    ], { onSubmit: (v) => Api.actualizarCliente(c.id_usuario, { nombre: v.nombre, telefono: v.telefono || null, activo: Boolean(c.activo) }) });
    if (r) { toast('Cliente actualizado', 'ok'); this.#clientes(); }
  }

  async #toggleCliente(c) {
    const des = Boolean(c.activo);
    if (des && !await confirmDialog('Desactivar cliente', `Se cerrarán las sesiones de ${c.email}, se detendrán sus unidades y no podrá entrar hasta reactivarlo.`, { ok: 'Desactivar', danger: true })) return;
    try {
      await Api.actualizarCliente(c.id_usuario, { nombre: c.nombre, telefono: c.telefono || null, activo: !des });
      toast(des ? 'Cliente desactivado y sesiones revocadas' : 'Cliente reactivado', 'ok');
      this.#clientes();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ================================================================ Demos (Admin: fábrica · Usuario: privadas)
  async #demos() {
    const unidades = (await Api.unidades()).filter((u) => u.estado !== 'VENDIDO' && u.activo);
    this.#demoScreen(unidades, 'FABRICA', (d) => d.tipo === 'FABRICA',
      'Demos de fábrica: las ven compradores e invitados de la unidad. Las demos privadas de los compradores no se muestran aquí.');
  }

  async #misDemos() {
    const unidades = await Api.misVehiculos();
    this.#demoScreen(unidades, 'PRIVADA', (d) => d.tipo === 'PRIVADA',
      'Tus demos son privadas: solo tú las ves y ejecutas. Las de fábrica aparecen en modo lectura.');
  }

  #demoScreen(unidades, tipo, canEdit, nota) {
    if (!unidades.length) { this.#body(el('p', { class: 'muted' }, tipo === 'FABRICA' ? 'No hay unidades no vendidas activas.' : 'Aún no tienes vehículos asignados.')); return; }
    const pick = el('select', { 'aria-label': 'Unidad' }, unidades.map((u) => el('option', { value: u.id, selected: u.id === vehicle.current?.id }, `${u.codigo} · ${u.modelo || u.nombre}`)));
    const host = el('div', { class: 'demo-host' });
    const mount = () => new DemoEditor(host, { vehicleId: Number(pick.value), tipo, canEdit,
      onChanged: () => { if (Number(pick.value) === vehicle.current?.id) bus.emit('demos:changed'); } }).load();
    pick.addEventListener('change', mount);
    this.#body(el('div', { class: 'toolbar' }, el('label', { class: 'inline-field' }, el('span', {}, 'Unidad'), pick)),
      el('p', { class: 'note' }, nota), host);
    mount();
  }

  // ================================================================ ADMIN · Auditoría
  async #auditoria(offset = 0, resultado = '') {
    const r = await Api.auditoria(offset, { resultado });
    const sel = el('select', { 'aria-label': 'Filtrar por resultado' }, ['', 'OK', 'DENEGADO', 'ERROR'].map((v) =>
      el('option', { value: v, selected: v === resultado }, v || 'Todos los resultados')));
    sel.addEventListener('change', () => this.#auditoria(0, sel.value).catch((e) => toast(e.message, 'error')));
    const pages = el('div', { class: 'pager' },
      el('button', { type: 'button', class: 'btn-ghost btn-sm', disabled: offset === 0, onclick: () => this.#auditoria(Math.max(0, offset - 25), resultado) }, icon('bi-chevron-left'), ' Anterior'),
      el('span', { class: 'muted' }, `${r.total ? offset + 1 : 0}–${Math.min(offset + 25, r.total)} de ${r.total}`),
      el('button', { type: 'button', class: 'btn-ghost btn-sm', disabled: offset + 25 >= r.total, onclick: () => this.#auditoria(offset + 25, resultado) }, 'Siguiente ', icon('bi-chevron-right')));
    this.#body(el('div', { class: 'toolbar' }, sel, pages),
      el('div', { class: 'table-wrap' }, el('table', { class: 'data-table' },
        el('thead', {}, el('tr', {}, ['Fecha', 'Actor', 'Acción', 'Recurso', 'Resultado', 'Detalle'].map((h) => el('th', { scope: 'col' }, h)))),
        el('tbody', {}, (r.registros || []).map((a) => el('tr', {},
          el('td', { class: 'mono' }, fecha(a.fecha)), el('td', {}, `${a.actor} `, el('small', { class: 'muted' }, a.actor_tipo)),
          el('td', { class: 'mono' }, a.accion), el('td', {}, `${a.recurso}${a.id_recurso ? ` #${a.id_recurso}` : ''}`),
          el('td', {}, el('span', { class: 'tag', dataset: { s: a.resultado === 'OK' ? 'rest' : 'error' } }, a.resultado)),
          el('td', { class: 'cell-wrap' }, a.detalle || '—')))))));
  }

  // ================================================================ USUARIO · Mis vehículos
  async #mis() {
    const unidades = await Api.misVehiculos();
    if (!unidades.length) { this.#body(el('p', { class: 'muted' }, 'Aún no tienes vehículos asignados. Cuando la empresa te asigne uno aparecerá aquí.')); return; }
    this.#body(el('div', { class: 'card-grid' }, unidades.map((u) => el('article', { class: 'panel unit-card' },
      el('div', { class: 'panel-head' }, el('h3', { class: 'panel-title' }, icon('bi-truck'), ` ${u.modelo || u.nombre}`), tag(u.estado)),
      el('p', { class: 'mono' }, u.codigo),
      el('p', {}, el('span', { class: `dot ${u.dispositivo ? 'dot--ok' : ''}` }), u.dispositivo ? ' ESP8266 en línea' : ' Sin señal del dispositivo'),
      el('div', { class: 'btn-row' },
        el('button', { type: 'button', class: 'btn-primary btn-sm', onclick: () => { vehicle.select(u.id); go('control'); } }, icon('bi-controller'), ' Controlar'),
        el('button', { type: 'button', class: 'btn-ghost btn-sm', onclick: () => { vehicle.select(u.id); go('monitoreo'); } }, icon('bi-activity'), ' Monitorear')),
      el('div', { class: 'support-box' },
        el('p', {}, icon('bi-headset'), u.soporte?.activo ? ` Soporte autorizado · ${Math.ceil(u.soporte.segundos / 60)} min restantes` : ' La empresa no puede operar ni monitorear esta unidad.'),
        u.soporte?.activo
          ? el('button', { type: 'button', class: 'btn-ghost btn-sm btn-danger-text', onclick: () => this.#revocarSoporte(u) }, 'Revocar soporte')
          : el('button', { type: 'button', class: 'btn-ghost btn-sm', onclick: () => this.#otorgarSoporte(u) }, 'Autorizar soporte'))))));
  }

  async #otorgarSoporte(u) {
    const r = await formDialog(`Autorizar soporte · ${u.codigo}`, [
      { name: 'minutos', label: 'Duración', type: 'select', value: '30', options: [15, 30, 60, 120].map((m) => ({ value: m, label: `${m} minutos` })) },
      { name: 'motivo', label: 'Motivo (opcional)', type: 'textarea', maxlength: 255 }
    ], { submit: 'Autorizar', onSubmit: (v) => Api.otorgarSoporte(u.id, Number(v.minutos), v.motivo || null) });
    if (r) { toast(r.mensaje, 'ok'); this.#mis(); }
  }

  async #revocarSoporte(u) {
    try { await Api.revocarSoporte(u.id); toast('Soporte revocado', 'ok'); this.#mis(); }
    catch (e) { toast(e.message, 'error'); }
  }
}
