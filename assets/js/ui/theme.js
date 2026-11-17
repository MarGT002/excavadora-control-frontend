/**
 * Modo claro / oscuro. El tema inicial lo fija un script en <head> (sin parpadeo);
 * aquí solo se alterna y se recuerda en este navegador.
 */
const KEY = 'excavadora.theme';
const META_COLOR = { dark: '#0a0f1d', light: '#f2f5fc' };

function apply(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    const light = theme === 'light';
    btn.setAttribute('aria-pressed', String(light));
    btn.setAttribute('aria-label', light ? 'Activar modo oscuro' : 'Activar modo claro');
    btn.title = light ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro';
    btn.querySelector('.bi').className = `bi ${light ? 'bi-moon-stars-fill' : 'bi-sun-fill'}`;
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLOR[theme]);
}

export function initTheme() {
  apply(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    apply(next);
    try { localStorage.setItem(KEY, next); } catch { /* sin almacenamiento */ }
  });
}
