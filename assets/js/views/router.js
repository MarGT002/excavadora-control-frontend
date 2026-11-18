import { bus } from '../core/store.js';
import { session } from '../core/session.js';

const VIEWS = ['inicio', 'control', 'monitoreo', 'admin'];

/** Vistas que cada rol puede ABRIR en el menú (la seguridad real la aplica el backend en cada petición). */
const ALLOWED = {
  none: ['inicio'],
  INVITADO: ['inicio', 'control'],
  USUARIO: ['control', 'monitoreo', 'admin'],
  ADMIN: ['admin', 'control', 'monitoreo']
};

/**
 * Navegación por hash (#inicio / #control / #monitoreo / #admin): una sola página, por lo que todas las vistas
 * comparten la misma sesión WSS y no se recarga el documento. Funciona en subrutas de GitHub Pages.
 */
export function initRouter() {
  const links = [...document.querySelectorAll('.viewnav-link')];

  const show = () => {
    const role = session.role ?? 'none';
    const allowed = ALLOWED[role];
    const wanted = location.hash.slice(1);
    const name = allowed.includes(wanted) ? wanted : allowed[0];
    if (wanted !== name) history.replaceState(null, '', `#${name}`);

    VIEWS.forEach((v) => { document.getElementById(`view-${v}`).hidden = v !== name; });
    links.forEach((a) => {
      a.hidden = !allowed.includes(a.dataset.view);
      if (a.dataset.view === name) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.body.dataset.view = name;
    document.body.dataset.role = role;
    bus.emit('view:changed', name);
  };

  window.addEventListener('hashchange', show);
  bus.on('session:changed', show);
  bus.on('router:refresh', show);
  show();
}

export function go(view) {
  if (location.hash.slice(1) === view) bus.emit('router:refresh');
  else location.hash = view;
}
