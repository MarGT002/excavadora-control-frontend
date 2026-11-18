/**
 * Punto de entrada. Orquesta los módulos; no contiene reglas de negocio.
 *
 *  services/  http.js (Fetch + timeout + Bearer) · api.js (contratos REST) · ws.js (WSS autenticado por unidad)
 *  core/      store.js (bus) · session.js · vehicle.js (unidad activa) · reserva.js (invitado) · catalog.js
 *             command-service.js · demo-service.js · toggle-state.js · connectivity.js
 *  ui/        joystick.js · gamepad.js · indicators.js · toast.js · theme.js · modal.js · demo-editor.js
 *  views/     router.js · inicio-view.js · control-view.js · monitor-view.js · admin-view.js
 */
import { bus } from './core/store.js';
import { session } from './core/session.js';
import { vehicle } from './core/vehicle.js';
import './core/reserva.js';
import { catalog } from './core/catalog.js';
import { connectivity } from './core/connectivity.js';
import './core/toggle-state.js';
import { Api } from './services/api.js';
import { wsClient } from './services/ws.js';
import { initIndicators } from './ui/indicators.js';
import { toast } from './ui/toast.js';
import { initTheme } from './ui/theme.js';
import { initRouter } from './views/router.js';
import { InicioView } from './views/inicio-view.js';
import { ControlView } from './views/control-view.js';
import { MonitorView } from './views/monitor-view.js';
import { AdminView } from './views/admin-view.js';
import { el } from './utils/dom.js';

const $ = (id) => document.getElementById(id);
const ESTADOS = { DISPONIBLE: 'Disponible', VENDIDO: 'Vendida', EXHIBICION: 'Exhibición', INACTIVO: 'Inactiva' };
const ROLES = { ADMIN: 'Administrador · empresa', USUARIO: 'Usuario · comprador', INVITADO: 'Invitado · prueba temporal' };

initTheme();
initIndicators();
const control = new ControlView();
const monitor = new MonitorView();
new InicioView();
new AdminView();

bus.on('view:changed', (view) => {
  if (view !== 'control') control.releaseAll();      // nunca dejar una palanca "pegada"
  if (view === 'monitoreo') monitor.refresh();
});

// ---------------------------------------------------------------- sesión
const narrow = matchMedia('(max-width: 575.98px)');
function setAdminLabel() {
  $('admin-label').textContent = session.isAdmin ? (narrow.matches ? 'Admin' : 'Administración') : 'Mi cuenta';
}
narrow.addEventListener('change', setAdminLabel);

async function onSession(user) {
  $('user-menu').hidden = !user;
  setAdminLabel();
  if (!user) {
    wsClient.stop();
    vehicle.clear();
    $('unit-kicker').textContent = 'Plataforma IoT';
    $('vehicle-name').textContent = 'Excavadora IoT';
    return;
  }
  $('user-avatar').textContent = (user.nombre || '?').trim().charAt(0).toUpperCase();
  $('user-name').textContent = user.nombre || 'Invitado';
  $('user-role').textContent = `${ROLES[user.tipo] ?? user.tipo}${user.email ? ` · ${user.email}` : ''}`;
  if (session.isGuest) return;                       // la unidad del invitado la fija su reserva (core/reserva.js)
  try { await vehicle.loadForSession(); }
  catch (e) { toast(`No se pudieron cargar las unidades: ${e.message}`, 'error'); }
}
bus.on('session:changed', onSession);

function expire(msg) {
  if (!session.role) return;
  toast(msg, 'warn', 5000);
  session.logout({ remote: false });
}
bus.on('auth:expired', () => expire('Tu sesión expiró o fue cerrada. Inicia sesión de nuevo.'));
bus.on('ws:denied', (d) => { if (d.kind === 'auth') expire('Sesión no válida para el canal en tiempo real. Inicia sesión de nuevo.'); });

// ---------------------------------------------------------------- unidad activa
bus.on('vehicles:list', (list) => {
  const sel = $('unit-select');
  sel.replaceChildren(...list.map((u) => el('option', { value: u.id }, `${u.codigo} · ${u.modelo || u.nombre}${session.isAdmin ? ` (${ESTADOS[u.estado] ?? u.estado})` : ''}`)));
  if (vehicle.current) sel.value = String(vehicle.current.id);
  $('unit-picker').hidden = list.length < 2;
  $('vehicle-name').hidden = list.length >= 2;
});
$('unit-select').addEventListener('change', (e) => vehicle.select(e.target.value));

bus.on('vehicle:changed', async (u) => {
  wsClient.start(u ? session.token : null);          // cierra la suscripción anterior y abre la nueva
  catalog.reset();
  if (!u) return;
  $('unit-select').value = String(u.id);
  $('vehicle-name').textContent = u.nombre || u.modelo || 'Unidad';
  $('unit-kicker').textContent = [u.codigo, ESTADOS[u.estado]].filter(Boolean).join(' · ');
  loadCatalog(u.id);
  try {
    const d = await Api.vehiculo();
    if (vehicle.current?.id !== u.id) return;
    $('vehicle-name').textContent = d.nombre;
    $('unit-kicker').textContent = [d.codigo, ESTADOS[d.estado]].filter(Boolean).join(' · ');
    $('last-vehicle').textContent = d.nombre;
    bus.emit('ws:message', { tipo: 'dispositivo', conectado: d.dispositivo, idVehiculo: u.id });
  } catch (e) {
    if (e.status === 403) toast(`${u.codigo}: ${e.message}`, 'warn', 5000);
  }
});

async function loadCatalog(id, attempt = 1) {
  try {
    await catalog.load();
  } catch (e) {
    if (vehicle.current?.id !== id || e.status === 403 || e.status === 404 || e.status === 401) return;
    if (attempt === 1) toast(`No se pudo cargar el catálogo: ${e.message}. Reintentando…`, 'error');
    setTimeout(() => loadCatalog(id, attempt + 1), Math.min(3000 * attempt, 15000));
  }
}

// ---------------------------------------------------------------- menú de usuario
const pop = $('user-pop');
$('user-btn').addEventListener('click', () => {
  pop.hidden = !pop.hidden;
  $('user-btn').setAttribute('aria-expanded', String(!pop.hidden));
});
document.addEventListener('click', (e) => {
  if (!pop.hidden && !e.target.closest('#user-menu')) { pop.hidden = true; $('user-btn').setAttribute('aria-expanded', 'false'); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { pop.hidden = true; $('user-btn').focus(); } });
$('btn-logout').addEventListener('click', async () => {
  pop.hidden = true;
  if (vehicle.current && catalog.loaded) control.stopAll();
  if (session.isGuest) { try { await Api.terminarReserva(); } catch { /* sin reserva */ } }
  await session.logout();
  toast('Sesión cerrada', 'info');
});

// ---------------------------------------------------------------- arranque
connectivity.start();
(async () => {
  const restored = await session.restore();
  initRouter();
  if (restored) bus.emit('session:changed', session.user);
})();
