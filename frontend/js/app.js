// app.js - bootstrap and the public module-registration contract.
//
// =====================================================================
//  ARCHITECTURE CONTRACT (read this before adding a feature module)
// =====================================================================
//
//  Global namespace exposed once bootstrap runs:
//    window.Screener = {
//      store,                       // singleton from state.js
//      api,                         // wrappers from api.js
//      format,                      // formatters from format.js
//      table,                       // TableView instance (the live grid)
//      registerModule(name, initFn),// queue a feature module init
//      ready(fn),                   // run fn after bootstrap (or now if done)
//      toast(msg, opts),            // neon toast helper {title,kind:'info'|'ok'|'err'}
//    }
//
//  How a later parallel agent adds a feature (e.g. filters.js):
//    1. Create frontend/js/filters.js as an ES module.
//    2. At the bottom of that file:
//         window.Screener.registerModule('filters', (ctx) => {
//           // ctx = { store, api, format, el }
//           //   el(id) -> document.getElementById(id)
//           const panel = ctx.el('filter-panel');   // your mount point
//           // build UI, subscribe via ctx.store.subscribe(...),
//           // and call ctx.store.runScreen() to re-run.
//         });
//    3. Add ONE <script type="module" src="js/filters.js"></script> line
//       inside the MODULE SCRIPTS region in index.html (marked there).
//
//  registerModule init fns run AFTER the initial catalog load + first screen,
//  in registration order. The app renders fully with ZERO feature modules.
//
//  Re-running a screen: any module may call store.runScreen(). The TableView
//  re-renders automatically because app.js subscribes to the store.
//
//  Mount-point ids (in index.html): topbar, market-switcher, topbar-actions,
//  status-bar, left-rail, preset-panel, filter-panel, column-panel,
//  factor-panel, saved-panel, main-panel, toolbar, table-toolbar, table-host,
//  summary-footer, drawer-host, command-palette-host, toast-host.
// =====================================================================

import store from './state.js';
import api, { formatLatency } from './api.js';
import * as format from './format.js';
import { TableView } from './table.js';

const el = (id) => document.getElementById(id);

// ---- Module registry. Parallel agents push init fns here via registerModule.
const _modules = [];
let _booted = false;
const _readyQueue = [];

function registerModule(name, initFn) {
  _modules.push({ name, initFn });
  // If a module registers after boot (lazy script), init it immediately.
  if (_booted) runModule({ name, initFn });
}

function runModule(mod) {
  try {
    mod.initFn({ store, api, format, el });
  } catch (err) {
    console.error(`module "${mod.name}" init failed:`, err);
  }
}

function ready(fn) {
  if (_booted) fn();
  else _readyQueue.push(fn);
}

// ---- Toast helper (in-theme). kind: 'info' | 'ok' | 'err' (default err).
function toast(message, opts = {}) {
  const host = el('toast-host');
  if (!host) return;
  const kind = opts.kind || 'err';
  const node = document.createElement('div');
  node.className = 'toast ' + (kind === 'ok' ? 'toast-ok' : kind === 'info' ? 'toast-info' : '');
  if (opts.title) {
    const t = document.createElement('div');
    t.className = 'toast-title';
    t.textContent = opts.title;
    node.appendChild(t);
  }
  const m = document.createElement('div');
  m.textContent = message;
  node.appendChild(m);
  host.appendChild(node);
  setTimeout(() => node.remove(), opts.duration || 4500);
}

// ---- Build the namespace immediately so module scripts can register even if
// they load before bootstrap finishes.
const table = new TableView(null, {});
window.Screener = { store, api, format, table, registerModule, ready, toast };

// ---- Default columns per market. Mirrors backend DEFAULT_COLUMNS so the very
// first paint matches what the server would pick, plus a couple extras for
// america to read like a real terminal.
const DEFAULT_COLUMNS = {
  america: ['name', 'description', 'close', 'change', 'volume', 'market_cap_basic', 'price_earnings_ttm', 'sector'],
  crypto: ['name', 'description', 'close', 'change', 'volume', 'market_cap_calc', 'Value.Traded'],
  forex: ['name', 'description', 'close', 'change', 'high', 'low'],
  futures: ['name', 'description', 'close', 'change', 'volume', 'high', 'low'],
  bond: ['name', 'description', 'close', 'change', 'high', 'low'],
  cfd: ['name', 'description', 'close', 'change', 'high', 'low'],
};
function defaultColumns(market) {
  return (DEFAULT_COLUMNS[market] || DEFAULT_COLUMNS.america).slice();
}

// ---- UI wiring: status bar, loading overlay, table render, on every change.
function renderStatus() {
  const s = store.state;
  const bar = el('status-bar');
  if (!bar) return;
  const result = s.result;
  const dotClass = s.loading ? 'busy' : s.error ? 'err' : '';
  const count = result ? result.count : 0;
  bar.innerHTML = '';
  const dot = document.createElement('span');
  dot.className = 'dot ' + dotClass;
  bar.appendChild(dot);
  const parts = [
    ['MARKET', s.market],
    ['MATCHES', count.toLocaleString('en-US')],
    ['LATENCY', s.error && !s.keptPrevious ? '--' : formatLatency(result && result.meta)],
  ];
  for (const [k, v] of parts) {
    const span = document.createElement('span');
    span.innerHTML = `<span class="stat-k">${k}</span> <span class="stat-v">${v}</span>`;
    bar.appendChild(span);
  }
}

function renderOverlay() {
  const host = el('table-host');
  if (!host) return;
  let overlay = host.querySelector('.overlay');
  if (store.state.loading) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'overlay';
      overlay.innerHTML = '<div class="spinner"></div><div class="loading-label">Scanning market</div>';
      host.appendChild(overlay);
    }
  } else if (overlay) {
    overlay.remove();
  }
}

// Inline banner shown when a refresh failed but the previous table was kept.
function renderErrorBanner() {
  const s = store.state;
  let banner = el('screen-error');
  const show = !!s.error && s.keptPrevious && !s.loading;
  if (!show) {
    if (banner) banner.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'screen-error';
    banner.setAttribute('role', 'alert');
    const msg = document.createElement('span');
    msg.className = 'screen-error-msg';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-primary';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => store.runScreen());
    banner.append(msg, retry);
    const host = el('table-host');
    host.parentNode.insertBefore(banner, host);
  }
  banner.querySelector('.screen-error-msg').textContent = 'Refresh failed: ' + s.error.replace(/[.\s]+$/, '') + '. Showing the previous results.';
}

function dismissSplash() {
  const splash = el('boot-splash');
  if (!splash) return;
  splash.classList.add('done');
  setTimeout(() => splash.remove(), 400);
}

let _lastResult = null;
function onStateChange() {
  renderStatus();
  renderOverlay();
  renderErrorBanner();
  const s = store.state;
  // Re-render the table only when the result object actually changed.
  if (s.result && s.result !== _lastResult) {
    _lastResult = s.result;
    table.setFieldsIndex(s.fieldIndex);
    table.render(s.result);
  }
}

// ---- Build the market switcher <select> and the RUN SCAN button.
function buildTopbarControls() {
  const switcher = el('market-switcher');
  if (switcher) {
    switcher.innerHTML = '';
    const label = document.createElement('span');
    label.className = 'eyebrow';
    label.textContent = 'Market';
    const select = document.createElement('select');
    select.className = 'select glow-hover';
    select.id = 'market-select';
    for (const m of store.state.markets) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      if (m.id === store.state.market) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      store.setMarket(select.value, defaultColumns(select.value));
    });
    switcher.appendChild(label);
    switcher.appendChild(select);
  }

  const toolbar = el('table-toolbar');
  if (toolbar && !el('run-scan-btn')) {
    const run = document.createElement('button');
    run.className = 'btn btn-primary';
    run.id = 'run-scan-btn';
    run.textContent = 'Run Scan';
    run.addEventListener('click', () => store.runScreen());
    toolbar.appendChild(run);
  }
}

// ---- Bootstrap sequence.
let _subscribed = false;

function showBootFailure(message) {
  const host = el('table-host');
  if (!host) return;
  host.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'empty-card';
  card.setAttribute('role', 'alert');
  const title = document.createElement('div');
  title.className = 'empty-title';
  title.textContent = 'COULD NOT START';
  const body = document.createElement('div');
  body.textContent = message;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn btn-primary';
  retry.textContent = 'Retry';
  retry.addEventListener('click', () => boot());
  card.append(title, body, retry);
  host.appendChild(card);
}

async function boot() {
  if (!_subscribed) {
    store.subscribe(onStateChange);
    _subscribed = true;
  }
  table.container = el('table-host');
  const splash = el('boot-splash');
  if (splash) splash.classList.remove('done');

  try {
    const [markets, fieldsResp, presetsResp] = await Promise.all([
      api.getMarkets(),
      api.getFields(),
      api.getPresets(),
    ]);
    store.indexFields(fieldsResp.fields);
    store.set({
      markets,
      presets: presetsResp.presets,
      factorPresets: presetsResp.factor_presets,
      columns: defaultColumns('america'),
    });
  } catch (err) {
    console.error('boot catalog load failed:', err);
    showBootFailure(String((err && err.message) || err));
    dismissSplash();
    return;
  }

  buildTopbarControls();

  // Initial america screen.
  await store.runScreen();
  dismissSplash();

  // Run any feature modules that registered, then flush ready callbacks.
  if (!_booted) {
    _booted = true;
    for (const mod of _modules) runModule(mod);
    while (_readyQueue.length) _readyQueue.shift()();
  }
}

document.addEventListener('screener:retry', () => {
  if (_booted) store.runScreen();
  else boot();
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

export { store, api, format, table, registerModule, ready, toast };
