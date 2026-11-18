/**
 * Construcción segura del DOM: todo texto entra como textContent (los datos de la API nunca se interpretan como HTML).
 *   el('button', { class: 'btn', onclick: fn, 'aria-label': 'x' }, 'Texto', otroNodo)
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'value') node.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'required') node[k] = Boolean(v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const icon = (name) => el('i', { class: `bi ${name}`, 'aria-hidden': 'true' });

export function clear(node) { node.replaceChildren(); return node; }
