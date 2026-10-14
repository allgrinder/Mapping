// API-Client: hält das CSRF-Token und setzt es bei allen ändernden Anfragen.
let csrfToken = null;
const listeners = new Set();

export class ApiError extends Error {
  constructor(status, code, message, fields = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function onAuthError(fn) {
  listeners.add(fn);
}

export function setCsrf(token) {
  csrfToken = token || null;
}

export async function api(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'network', 'Der Server ist nicht erreichbar.');
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (data && typeof data.csrfToken === 'string') csrfToken = data.csrfToken;
  if (!res.ok) {
    const e = data?.error || {};
    const err = new ApiError(res.status, e.code || 'http_' + res.status, e.message || 'Unbekannter Fehler.', e.fields || {});
    if (e.code === 'unauthenticated' || e.code === 'password_change_required') listeners.forEach((fn) => fn(err));
    throw err;
  }
  return data;
}
