// api.js — async wrappers over the backend REST API.
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

async function getJSON(path) {
  const res = await fetch(BASE + path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  return res.json();
}

async function postJSON(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${res.statusText}`);
  return res.json();
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
