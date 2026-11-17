import { bus } from '../core/store.js';

const VIEWS = ['control', 'monitoreo'];

/**
 * Navegación por hash (#control / #monitoreo): una sola página, por lo que ambas vistas
 * comparten la misma sesión WSS y no se recarga el documento. Funciona en subrutas de GitHub Pages.
 */
export function initRouter() {
  const links = [...document.querySelectorAll('.viewnav-link')];

  const show = () => {
    const name = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'control';
    VIEWS.forEach((v) => { document.getElementById(`view-${v}`).hidden = v !== name; });
    links.forEach((a) => {
      if (a.dataset.view === name) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.body.dataset.view = name;
    bus.emit('view:changed', name);
  };

  window.addEventListener('hashchange', show);
  show();
}
