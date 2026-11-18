import { el, icon } from '../utils/dom.js';

/**
 * Diálogo modal accesible (<dialog> nativo: foco atrapado y Esc para cerrar).
 * form(): muestra un formulario y resuelve con los valores, o null si se cancela.
 * confirm(): resuelve true/false.
 */
const dlg = () => document.getElementById('modal');

function open(title, body, actions) {
  const d = dlg();
  return new Promise((resolve) => {
    const close = (v) => { d.close(); resolve(v); };
    const form = el('form', { class: 'modal-form', method: 'dialog', novalidate: true },
      el('div', { class: 'modal-head' },
        el('h3', { id: 'modal-title', class: 'panel-title' }, title),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Cerrar', onclick: () => close(null) }, icon('bi-x-lg'))),
      el('div', { class: 'modal-body' }, body),
      el('p', { class: 'form-error', role: 'alert', hidden: true }),
      el('div', { class: 'modal-actions' }, actions(close)));
    d.replaceChildren(form);
    d.onclose = () => resolve(null);
    d.showModal();
    form.querySelector('input, select, textarea, button.btn-primary')?.focus();
    form.addEventListener('submit', (e) => e.preventDefault());
    d._form = form;
  });
}

/** fields: [{ name, label, type, value, required, options:[{value,label}], min, max, maxlength, help, pattern }] */
export function formDialog(title, fields, { submit = 'Guardar', onSubmit } = {}) {
  const inputs = {};
  const body = fields.map((f) => {
    let input;
    if (f.type === 'select') {
      input = el('select', { name: f.name, required: f.required },
        f.options.map((o) => el('option', { value: o.value, selected: String(o.value) === String(f.value ?? '') }, o.label)));
    } else if (f.type === 'checkbox') {
      input = el('input', { type: 'checkbox', name: f.name, checked: Boolean(f.value) });
    } else if (f.type === 'textarea') {
      input = el('textarea', { name: f.name, rows: 2, maxlength: f.maxlength ?? 255 }, f.value ?? '');
    } else {
      input = el('input', { type: f.type || 'text', name: f.name, value: f.value ?? '', required: f.required,
        min: f.min, max: f.max, maxlength: f.maxlength, pattern: f.pattern, autocomplete: f.autocomplete || 'off', inputmode: f.inputmode });
    }
    inputs[f.name] = input;
    return el('label', { class: `field${f.type === 'checkbox' ? ' field--check' : ''}` },
      el('span', {}, f.label), input, f.help ? el('small', { class: 'muted' }, f.help) : null);
  });

  return open(title, body, (close) => {
    const ok = el('button', { type: 'submit', class: 'btn-primary' }, submit);
    ok.addEventListener('click', async () => {
      const form = dlg()._form;
      const errEl = form.querySelector('.form-error');
      const invalid = Object.values(inputs).find((i) => i.willValidate && !i.checkValidity());
      if (invalid) { errEl.textContent = `Revisa el campo «${invalid.closest('label').firstChild.textContent}».`; errEl.hidden = false; invalid.focus(); return; }
      const values = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.type === 'checkbox' ? i.checked : i.value.trim()]));
      if (!onSubmit) { close(values); return; }
      ok.disabled = true;
      try { close(await onSubmit(values)); }
      catch (e) { errEl.textContent = e.message; errEl.hidden = false; ok.disabled = false; }
    });
    return [el('button', { type: 'button', class: 'btn-ghost', onclick: () => close(null) }, 'Cancelar'), ok];
  });
}

export function confirmDialog(title, message, { ok = 'Confirmar', danger = false } = {}) {
  return open(title, el('p', {}, message), (close) => [
    el('button', { type: 'button', class: 'btn-ghost', onclick: () => close(false) }, 'Cancelar'),
    el('button', { type: 'submit', class: danger ? 'btn-danger' : 'btn-primary', onclick: () => close(true) }, ok)
  ]).then(Boolean);
}

export function infoDialog(title, nodes) {
  return open(title, nodes, (close) => [el('button', { type: 'submit', class: 'btn-primary', onclick: () => close(true) }, 'Entendido')]);
}
