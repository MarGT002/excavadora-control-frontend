/** Avisos breves y accesibles (texto plano; nunca HTML remoto). */
export function toast(message, kind = 'info', ms = 3200) {
  const zone = document.getElementById('toast-zone');
  if (!zone) return;
  const el = document.createElement('div');
  el.className = `toast-msg toast-msg--${kind}`;
  const icon = document.createElement('i');
  icon.className = `bi ${{ error: 'bi-exclamation-triangle-fill', ok: 'bi-check-circle-fill', warn: 'bi-exclamation-circle-fill' }[kind] ?? 'bi-info-circle-fill'}`;
  icon.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.textContent = message;
  el.append(icon, text);
  zone.append(el);
  while (zone.children.length > 3) zone.firstElementChild.remove();
  setTimeout(() => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 300); }, ms);
}
