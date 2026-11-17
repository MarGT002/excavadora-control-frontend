/**
 * Punto de entrada. Orquesta los módulos; no contiene reglas de negocio.
 *
 *  services/  http.js (Fetch + timeout) · api.js (contratos REST) · ws.js (WSS compartido)
 *  core/      store.js (bus) · catalog.js · command-service.js · demo-service.js · connectivity.js
 *  ui/        joystick.js · indicators.js · toast.js
 *  views/     router.js · control-view.js · monitor-view.js
 */
import { CONFIG } from './config.js';
import { bus, appState } from './core/store.js';
import { catalog } from './core/catalog.js';
import { connectivity } from './core/connectivity.js';
import { Api } from './services/api.js';
import { wsClient } from './services/ws.js';
import { initIndicators } from './ui/indicators.js';
import { toast } from './ui/toast.js';
import { initRouter } from './views/router.js';
import { ControlView } from './views/control-view.js';
import { MonitorView } from './views/monitor-view.js';

const control = new ControlView();
const monitor = new MonitorView();

initIndicators();
document.getElementById('vehicle-id').textContent = String(CONFIG.VEHICLE_ID);

// Al entrar a MONITOREO siempre se resincroniza por REST (estado + 10 movimientos).
bus.on('view:changed', (view) => {
  if (view !== 'control') control.releaseAll();      // nunca dejar una palanca "pegada"
  if (view === 'monitoreo') monitor.refresh();
});
initRouter();

wsClient.connect();
connectivity.start();

async function loadCatalog(attempt = 1) {
  try {
    await catalog.load();
  } catch (e) {
    if (attempt === 1) toast(`No se pudo cargar el catálogo: ${e.message}. Reintentando…`, 'error');
    setTimeout(() => loadCatalog(attempt + 1), Math.min(3000 * attempt, 15000));
  }
}

async function loadVehicle() {
  try {
    const v = await Api.vehiculo();
    appState.vehicleName = v.nombre;
    document.getElementById('vehicle-name').textContent = v.nombre;
    document.getElementById('last-vehicle').textContent = v.nombre;
  } catch { /* se conserva el nombre por defecto */ }
}

loadVehicle();
loadCatalog();
control.loadDemos();
