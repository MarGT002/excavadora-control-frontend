import { bus } from '../core/store.js';
import { wsClient } from '../services/ws.js';
import { formatTime } from '../utils/format.js';

/** [data-state, icono, texto]: texto + icono + color, nunca solo color. */
const MAP = {
  ws: {
    CONNECTING: ['wait', 'bi-arrow-repeat', 'Conectando…'],
    RECONNECTING: ['wait', 'bi-arrow-repeat', 'Reconectando…'],
    ONLINE: ['ok', 'bi-broadcast', 'En línea'],
    OFFLINE: ['bad', 'bi-x-circle', 'Desconectado'],
    IDLE: ['none', 'bi-dash-circle', 'Sin unidad']
  },
  api: {
    CHECKING: ['wait', 'bi-arrow-repeat', 'Comprobando…'],
    OK: ['ok', 'bi-cloud-check', 'Disponible'],
    DOWN: ['bad', 'bi-cloud-slash', 'No disponible']
  },
  db: {
    OK: ['ok', 'bi-database-check', 'Disponible'],
    DOWN: ['bad', 'bi-database-x', 'No disponible'],
    UNKNOWN: ['none', 'bi-database-dash', 'Sin verificar']
  }
};

function render(key, state, at) {
  const el = document.getElementById(`ind-${key}`);
  const def = MAP[key][state];
  if (!el || !def) return;
  const [s, icon, text] = def;
  el.dataset.state = s;
  el.querySelector('.status-icon').className = `bi ${icon} status-icon`;
  el.querySelector('.status-value').textContent = text;
  if (at) el.dataset.checked = `Última verificación ${formatTime(at)}`;
}

export function initIndicators() {
  bus.on('ws:status', (s) => render('ws', s));
  bus.on('health:api', ({ state, at }) => render('api', state, at));
  bus.on('health:db', ({ state, at }) => render('db', state, at));
  // Pulsar el indicador WSS fuerza un reintento inmediato si está desconectado.
  document.getElementById('ind-ws')?.addEventListener('click', () => wsClient.reconnectNow());
}
