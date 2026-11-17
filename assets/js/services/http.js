import { CONFIG } from '../config.js';

/** Error HTTP/red normalizado con mensaje apto para el usuario (sin trazas internas). */
export class ApiError extends Error {
  constructor(message, { status = 0, kind = 'http', detail = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;   // 0 = sin respuesta
    this.kind = kind;       // 'http' | 'network' | 'timeout' | 'abort' | 'invalid'
    this.detail = detail;
  }
}

const FRIENDLY = {
  400: 'Solicitud no válida',
  401: 'No autorizado',
  403: 'Acceso denegado',
  404: 'No encontrado',
  409: 'Conflicto: operación en curso',
  422: 'Datos no válidos',
  500: 'Error interno del servidor',
  502: 'Servidor no disponible',
  503: 'Servicio no disponible',
  504: 'El servidor tardó demasiado'
};

/**
 * Único punto de salida HTTP: URL base, headers, timeout con AbortController,
 * códigos HTTP, errores de red y JSON inválido.
 * @param {string} path ruta relativa (de route())
 * @param {{method?:string, body?:object, timeout?:number, signal?:AbortSignal}} opts
 */
export async function request(path, { method = 'GET', body, timeout = CONFIG.TIMEOUT_MS, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeout);
  const onExternalAbort = () => controller.abort('abort');
  signal?.addEventListener('abort', onExternalAbort, { once: true });

  let res;
  try {
    res = await fetch(`${CONFIG.API_BASE_URL}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
      mode: 'cors',
      credentials: 'omit'
    });
  } catch (e) {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      throw reason === 'abort'
        ? new ApiError('Solicitud cancelada', { kind: 'abort' })
        : new ApiError('Tiempo de espera agotado', { kind: 'timeout' });
    }
    throw new ApiError('Sin conexión con la API', { kind: 'network' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }

  const text = await res.text().catch(() => '');
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch { if (res.ok) throw new ApiError('Respuesta no válida del servidor', { status: res.status, kind: 'invalid' }); }
  }

  if (!res.ok) {
    // FastAPI devuelve {"detail": "..."}; solo se usa si es texto simple.
    const detail = typeof data?.detail === 'string' ? data.detail.slice(0, 160) : null;
    throw new ApiError(detail || FRIENDLY[res.status] || `Error HTTP ${res.status}`,
      { status: res.status, kind: 'http', detail });
  }
  return data ?? {};
}
