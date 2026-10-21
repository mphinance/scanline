// api.js - async wrappers over the backend REST API.
// All functions return parsed JSON or throw an Error with a useful message.
//
// Backend contract (verified live):
//   GET  /api/health   -> {ok, markets, fields, presets, factor_presets}
//   GET  /api/markets  -> [{id,label,kind}]                (raw array)
//   GET  /api/fields   -> {fields:[...], market_fields:{...}}
//   GET  /api/presets  -> {presets:[...], factor_presets:[...]}
//   POST /api/screen   -> {count, rows, columns, meta}
//
// Same-origin: the frontend is served by FastAPI at "/", so a relative base
// works in the browser. BASE can be overridden for headless testing.

const BASE = (typeof window !== 'undefined' && window.SCREENER_API_BASE) || '';

// Turn a FastAPI-style error body into one readable sentence. Handles
// {detail: "text"}, {detail: [{loc,msg}]} (422), {detail: {message}}, and the
// screen envelope's {meta: {error}}. Returns '' when nothing usable is found.
export function messageFromBody(body) {
  if (!body || typeof body !== 'object') return '';
  const d = body.detail;
  if (typeof d === 'string' && d.trim()) return d.trim();
  if (Array.isArray(d)) {
    const parts = d
      .map((x) => {
        if (typeof x === 'string') return x;
        if (!x || typeof x !== 'object') return '';
        const where = Array.isArray(x.loc) ? x.loc.filter((p) => p !== 'body').join('.') : '';
        return (where ? where + ': ' : '') + (x.msg || x.message || '');
      })
      .filter(Boolean);
    if (parts.length) return parts.join('; ');
  } else if (d && typeof d === 'object') {
    const m = d.message || d.error || d.msg;
    if (typeof m === 'string' && m.trim()) return m.trim();
  }
  const e = body.meta && body.meta.error;
  if (typeof e === 'string' && e.trim()) return e.trim();
  if (typeof body.error === 'string' && body.error.trim()) return body.error.trim();
  return '';
}

// Full user-facing message for a failed request.
export function describeFailure(status, statusText, body) {
  const fromBody = messageFromBody(body);
  if (fromBody) return fromBody;
  if (status === 502 || status === 503 || status === 504) {
    return 'The data provider is unavailable right now. Try again in a moment.';
  }
  return `Request failed (${status}${statusText ? ' ' + statusText : ''}).`;
}

export const NETWORK_MESSAGE = 'Cannot reach the Scanline server. Check that it is running, then retry.';

export class ApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request(path, init) {
  let res;
  try {
    res = await fetch(BASE + path, init);
  } catch (err) {
    throw new ApiError(NETWORK_MESSAGE, { status: 0 });
  }
  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch (err) {
      body = null;
    }
    throw new ApiError(describeFailure(res.status, res.statusText, body), { status: res.status, body });
  }
  return res.json();
}

function getJSON(path) {
  return request(path, { headers: { Accept: 'application/json' } });
}

function postJSON(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
}

// "123ms", "123ms cached", or a dash when the server sent no timing.
export function formatLatency(meta) {
  const ms = meta && meta.ms;
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '--';
  return Math.round(ms) + 'ms' + (meta.cached ? ' cached' : '');
}

// Liveness + catalog sizes.
export function getHealth() {
  return getJSON('/api/health');
}

// Returns an array of {id,label,kind}.
export function getMarkets() {
  return getJSON('/api/markets');
}

// Returns {fields:[{id,label,group,type,unit}], market_fields:{market:[ids]}}.
export function getFields() {
  return getJSON('/api/fields');
}

// Returns {presets:[...], factor_presets:[...]}.
export function getPresets() {
  return getJSON('/api/presets');
}

// Run a screen. body is the POST shape from state.buildScreenBody().
// Returns {count, rows, columns, meta}.
export function screen(body) {
  return postJSON('/api/screen', body);
}

export default { getHealth, getMarkets, getFields, getPresets, screen };
