// API-Client: hält das CSRF-Token und setzt es bei allen ändernden Anfragen.
import { setOffline, setDataAsOf, isOffline } from './ui/offline.js';

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

export const DEMO = import.meta.env.MODE === 'demo';

export async function api(method, path, body) {
  if (DEMO) {
    const { handle } = await import('./demo/server.js');
    try {
      const data = await handle(method, path, body === undefined ? undefined : JSON.parse(JSON.stringify(body)));
      if (data?.dataAsOf && path.startsWith('/facilities')) setDataAsOf(data.dataAsOf);
      return data;
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'unauthenticated' || err.code === 'password_change_required')) listeners.forEach((fn) => fn(err));
      throw err;
    }
  }
  if (method !== 'GET' && isOffline()) {
    throw new ApiError(0, 'offline', 'Offline – Änderungen sind derzeit nicht möglich.');
  }
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
    if (method === 'GET') setOffline(true);
    throw new ApiError(0, 'network', 'Der Server ist nicht erreichbar.');
  }
  if (method === 'GET') setOffline(res.headers.get('X-From-Cache') === '1' || navigator.onLine === false);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (data && typeof data.csrfToken === 'string') csrfToken = data.csrfToken;
  if (data?.dataAsOf && path.startsWith('/facilities')) setDataAsOf(data.dataAsOf);
  if (!res.ok) {
    const e = data?.error || {};
    const err = new ApiError(res.status, e.code || 'http_' + res.status, e.message || 'Unbekannter Fehler.', e.fields || {});
    if (Array.isArray(e.rows)) err.rows = e.rows;
    if (e.code === 'unauthenticated' || e.code === 'password_change_required') listeners.forEach((fn) => fn(err));
    throw err;
  }
  return data;
}
