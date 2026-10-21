// saved.js - SAVED SCREENS + WATCHLIST + CSV EXPORT.
//
// Three things, all localStorage-backed, no server-side persistence:
//   SAVED SCREENS  capture the full scan config under a user name, list as cards,
//                  load / rename / delete. Persists across reloads.
//   WATCHLIST      a list of tickers. Add via input, remove, persists. A topbar
//                  toggle renders a compact starred-rows view inside #saved-panel
//                  from the CURRENT result. Global helper window.ScanlineWatch.
//   CSV EXPORT     a topbar button that downloads the current result as CSV in
//                  displayed column order, quoting fields that need it.
//
// We do NOT depend on table.js (owned by another agent this wave). The watchlist
// view renders its own compact list from store.state.result.
//
// Registers as module 'saved'. No em dashes anywhere.

const LS_SCREENS = 'scanline.savedScreens';
const LS_WATCH = 'scanline.watchlist';

// ---- localStorage helpers, all guarded so a corrupt value never throws.
function loadArray(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

function saveArray(key, arr) {
  try {
    localStorage.setItem(key, JSON.stringify(arr));
  } catch (e) {
    console.error('saved: localStorage write failed for', key, e);
  }
}

// ---- The exact config we capture in a saved screen. Everything runScreen needs.
function captureConfig(state) {
  return {
    market: state.market,
    columns: Array.isArray(state.columns) ? state.columns.slice() : [],
    filters: Array.isArray(state.filters) ? state.filters.slice() : [],
    match: state.match || 'all',
    computed: Array.isArray(state.computed) ? state.computed.slice() : [],
    stats: Array.isArray(state.stats) ? state.stats.slice() : [],
    factor: state.factor || null,
    sort: Array.isArray(state.sort) ? state.sort.slice() : [],
  };
}

// ---- CSV: quote a single field if it contains comma, quote, newline, or CR.
// Embedded quotes are doubled per RFC 4180.
function csvCell(value) {
  if (value == null) return '';
  let s = String(value);
  if (/[",\r\n]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function buildCsv(result) {
  const columns = (result && result.columns) || [];
  const rows = (result && result.rows) || [];
  const lines = [];
  lines.push(columns.map(csvCell).join(','));
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(row ? row[c] : '')).join(','));
  }
  // CRLF line endings for the widest spreadsheet compatibility.
  return lines.join('\r\n');
}

function injectStyles() {
  if (document.getElementById('saved-styles')) return;
  const style = document.createElement('style');
  style.id = 'saved-styles';
  style.textContent = `
    .sav-root {
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
      min-height: 0;
    }
    .sav-section { display: flex; flex-direction: column; gap: var(--sp-2); }
    .sav-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 700;
    }
    .sav-count { font-family: var(--font-mono); font-size: 12px; color: var(--muted); opacity: 0.8; }
    .sav-input {
      flex: 1 1 auto;
      width: 100%;
      padding: 6px 10px;
      background: rgba(10, 10, 14, 0.8);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      color: var(--text);
      font-family: var(--font-mono);
      font-size: 12px;
      outline: none;
      transition: box-shadow 0.15s ease, border-color 0.15s ease;
    }
    .sav-input:hover { border-color: rgba(0, 240, 255, 0.4); }
    .sav-input:focus { border-color: var(--cyan); box-shadow: var(--glow-cyan); }
    .sav-inline { display: flex; gap: 6px; align-items: center; }
    .sav-btn {
      flex: 0 0 auto;
      padding: 6px 10px;
      background: rgba(0, 240, 255, 0.06);
      border: 1px solid rgba(0, 240, 255, 0.32);
      border-radius: var(--radius-sm);
      color: var(--cyan);
      font-weight: 600;
      font-size: 12px;
      letter-spacing: 0.04em;
      cursor: pointer;
      transition: box-shadow 0.15s ease, border-color 0.15s ease, background 0.15s ease;
    }
    .sav-btn:hover { border-color: var(--cyan); box-shadow: var(--glow-cyan); background: rgba(0, 240, 255, 0.12); }
    .sav-save {
      width: 100%;
      padding: 7px 10px;
      background: rgba(0, 255, 136, 0.08);
      border: 1px solid rgba(0, 255, 136, 0.4);
      border-radius: var(--radius-sm);
      color: var(--green);
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      cursor: pointer;
      transition: box-shadow 0.15s ease, border-color 0.15s ease, background 0.15s ease, transform 0.05s ease;
    }
    .sav-save:hover { border-color: var(--green); box-shadow: var(--glow-green); background: rgba(0, 255, 136, 0.16); }
    .sav-save:active { transform: translateY(1px); }
    .sav-list { display: flex; flex-direction: column; gap: var(--sp-2); }
    .sav-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--sp-2);
      padding: 7px 9px;
      background: var(--glass);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid var(--border-glass);
      border-left: 2px solid transparent;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease, transform 0.05s ease;
    }
    .sav-card:hover {
      border-color: rgba(0, 240, 255, 0.45);
      box-shadow: var(--glow-cyan);
      background: rgba(0, 240, 255, 0.05);
    }
    .sav-card:active { transform: translateY(1px); }
    .sav-card-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .sav-card-name {
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 600;
      color: var(--cyan);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sav-card-meta { font-family: var(--font-mono); font-size: 12px; color: var(--muted); }
    .sav-card-acts { display: flex; gap: 4px; flex: 0 0 auto; }
    .sav-ic {
      padding: 3px 7px;
      background: transparent;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      color: var(--muted);
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1;
      cursor: pointer;
      transition: color 0.15s ease, border-color 0.15s ease;
    }
    .sav-ic:hover { color: var(--text); border-color: rgba(0, 240, 255, 0.4); }
    .sav-ic.sav-del:hover { color: var(--pink); border-color: rgba(255, 0, 60, 0.4); }
    .sav-empty {
      padding: var(--sp-2);
      font-size: 12px;
      color: var(--muted);
      text-align: center;
      letter-spacing: 0.03em;
    }
    .sav-chips { display: flex; flex-wrap: wrap; gap: 5px; }
    .sav-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 6px 3px 8px;
      background: rgba(176, 38, 255, 0.08);
      border: 1px solid rgba(176, 38, 255, 0.35);
      border-radius: 999px;
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 600;
      color: var(--purple);
    }
    .sav-chip-x {
      cursor: pointer;
      color: var(--muted);
      font-size: 12px;
      line-height: 1;
    }
    .sav-chip-x:hover { color: var(--pink); }
    .sav-watch-rows { display: flex; flex-direction: column; gap: 4px; }
    .sav-watch-row {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 8px;
      align-items: baseline;
      padding: 4px 8px;
      background: var(--glass);
      border: 1px solid var(--border-glass);
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: 12px;
    }
    .sav-watch-tk { color: var(--cyan); font-weight: 600; }
    .sav-watch-px { color: var(--text); text-align: right; }
    .sav-watch-ch { text-align: right; }
    .sav-watch-ch.pos { color: var(--pos); }
    .sav-watch-ch.neg { color: var(--neg); }
    /* Topbar action buttons reuse the global .btn look, just keep them grouped. */
    .sav-topbar { display: flex; gap: var(--sp-2); align-items: center; }
    .sav-topbar .btn.is-on {
      border-color: var(--purple);
      color: var(--purple);
      box-shadow: var(--glow-purple);
      background: rgba(176, 38, 255, 0.12);
    }
  `;
  document.head.appendChild(style);
}

window.Screener.registerModule('saved', (ctx) => {
  const { store, el, format } = ctx;
  const panel = el('saved-panel');
  if (!panel) {
    console.warn('saved: #saved-panel not found, skipping.');
    return;
  }

  injectStyles();

  // ====================================================================
  //  WATCHLIST state + global helper
  // ====================================================================
  let watch = loadArray(LS_WATCH)
    .map((t) => String(t).trim().toUpperCase())
    .filter(Boolean);

  function persistWatch() {
    saveArray(LS_WATCH, watch);
  }

  // Try to read a ticker symbol off a result row. Backend rows key off the
  // requested columns. "name" is the ticker on TradingView data; fall back to
  // a few common id fields.
  function rowTicker(row) {
    if (!row) return '';
    const cand = row.name || row.ticker || row.symbol || '';
    return String(cand).trim().toUpperCase();
  }

  const ScanlineWatch = {
    has(ticker) {
      return watch.includes(String(ticker || '').trim().toUpperCase());
    },
    toggle(ticker) {
      const t = String(ticker || '').trim().toUpperCase();
      if (!t) return false;
      const i = watch.indexOf(t);
      if (i >= 0) watch.splice(i, 1);
      else watch.push(t);
      persistWatch();
      renderWatch();
      return watch.includes(t);
    },
    list() {
      return watch.slice();
    },
  };
  window.ScanlineWatch = ScanlineWatch;

  // ====================================================================
  //  PANEL LAYOUT
  // ====================================================================
  panel.classList.remove('slot-placeholder');
  panel.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'sav-root';

  // ---- SAVED SCREENS section ----------------------------------------
  const scrSection = document.createElement('div');
  scrSection.className = 'sav-section';

  const scrHead = document.createElement('div');
  scrHead.className = 'sav-head';
  const scrTitle = document.createElement('span');
  scrTitle.textContent = 'Saved Screens';
  const scrCount = document.createElement('span');
  scrCount.className = 'sav-count';
  scrHead.appendChild(scrTitle);
  scrHead.appendChild(scrCount);
  scrSection.appendChild(scrHead);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'sav-save';
  saveBtn.textContent = 'Save current screen';
  scrSection.appendChild(saveBtn);

  const scrList = document.createElement('div');
  scrList.className = 'sav-list';
  scrSection.appendChild(scrList);

  root.appendChild(scrSection);

  // ---- WATCHLIST section --------------------------------------------
  const wSection = document.createElement('div');
  wSection.className = 'sav-section';

  const wHead = document.createElement('div');
  wHead.className = 'sav-head';
  const wTitle = document.createElement('span');
  wTitle.textContent = 'Watchlist';
  const wCount = document.createElement('span');
  wCount.className = 'sav-count';
  wHead.appendChild(wTitle);
  wHead.appendChild(wCount);
  wSection.appendChild(wHead);

  const wInputRow = document.createElement('div');
  wInputRow.className = 'sav-inline';
  const wInput = document.createElement('input');
  wInput.type = 'text';
  wInput.className = 'sav-input';
  wInput.placeholder = 'Add ticker';
  wInput.setAttribute('aria-label', 'Add ticker to watchlist');
  const wAdd = document.createElement('button');
  wAdd.type = 'button';
  wAdd.className = 'sav-btn';
  wAdd.textContent = 'Add';
  wInputRow.appendChild(wInput);
  wInputRow.appendChild(wAdd);
  wSection.appendChild(wInputRow);

  const wChips = document.createElement('div');
  wChips.className = 'sav-chips';
  wSection.appendChild(wChips);

  const wRows = document.createElement('div');
  wRows.className = 'sav-watch-rows';
  wSection.appendChild(wRows);

  root.appendChild(wSection);
  panel.appendChild(root);

  // ====================================================================
  //  SAVED SCREENS behavior
  // ====================================================================
  let screens = loadArray(LS_SCREENS).filter((s) => s && typeof s === 'object');

  function persistScreens() {
    saveArray(LS_SCREENS, screens);
  }

  function loadScreen(entry) {
    const c = entry.config || {};
    store.set({
      market: c.market || store.state.market,
      columns: Array.isArray(c.columns) ? c.columns.slice() : store.state.columns,
      filters: Array.isArray(c.filters) ? c.filters.slice() : [],
      match: c.match || 'all',
      computed: Array.isArray(c.computed) ? c.computed.slice() : [],
      stats: Array.isArray(c.stats) ? c.stats.slice() : [],
      factor: c.factor || null,
      sort: Array.isArray(c.sort) ? c.sort.slice() : [],
      offset: 0,
    });
    store.runScreen();
    window.Screener.toast('Loaded "' + (entry.name || 'screen') + '".', {
      title: 'Saved screen',
      kind: 'ok',
    });
  }

  function renderScreens() {
    scrCount.textContent = String(screens.length);
    scrList.innerHTML = '';
    if (!screens.length) {
      const empty = document.createElement('div');
      empty.className = 'sav-empty';
      empty.textContent = 'No saved screens yet.';
      scrList.appendChild(empty);
      return;
    }
    for (const entry of screens) {
      const card = document.createElement('div');
      card.className = 'sav-card';

      const main = document.createElement('div');
      main.className = 'sav-card-main';
      const name = document.createElement('span');
      name.className = 'sav-card-name';
      name.textContent = entry.name || 'Untitled';
      const meta = document.createElement('span');
      meta.className = 'sav-card-meta';
      const c = entry.config || {};
      const nFilters = (c.filters && c.filters.length) || 0;
      const hasFactor = c.factor && c.factor.weights && c.factor.weights.length;
      meta.textContent =
        (c.market || '?') +
        ' . ' +
        nFilters +
        ' filter' +
        (nFilters === 1 ? '' : 's') +
        (hasFactor ? ' . factor' : '');
      main.appendChild(name);
      main.appendChild(meta);
      card.appendChild(main);

      const acts = document.createElement('div');
      acts.className = 'sav-card-acts';

      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'sav-ic';
      renameBtn.textContent = 'ren';
      renameBtn.title = 'Rename';
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = window.prompt('Rename screen', entry.name || '');
        if (next != null) {
          const trimmed = next.trim();
          if (trimmed) {
            entry.name = trimmed;
            persistScreens();
            renderScreens();
          }
        }
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'sav-ic sav-del';
      delBtn.textContent = '×'; // multiplication sign
      delBtn.title = 'Delete';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        screens = screens.filter((s) => s.id !== entry.id);
        persistScreens();
        renderScreens();
      });

      acts.appendChild(renameBtn);
      acts.appendChild(delBtn);
      card.appendChild(acts);

      card.addEventListener('click', () => loadScreen(entry));
      scrList.appendChild(card);
    }
  }

  saveBtn.addEventListener('click', () => {
    const name = window.prompt('Name this screen', 'My screen ' + (screens.length + 1));
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    // id derived inside the handler, never at module top level.
    const id = 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    screens.push({ id, name: trimmed, config: captureConfig(store.state) });
    persistScreens();
    renderScreens();
    window.Screener.toast('Saved "' + trimmed + '".', { title: 'Saved screen', kind: 'ok' });
  });

  // ====================================================================
  //  WATCHLIST behavior
  // ====================================================================
  function addTickerFromInput() {
    const t = wInput.value.trim().toUpperCase();
    if (!t) return;
    if (!watch.includes(t)) {
      watch.push(t);
      persistWatch();
    }
    wInput.value = '';
    renderWatch();
  }

  wAdd.addEventListener('click', addTickerFromInput);
  wInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTickerFromInput();
    }
  });

  function removeTicker(t) {
    watch = watch.filter((x) => x !== t);
    persistWatch();
    renderWatch();
  }

  // Look up the live row for a ticker in the current result, if present.
  function findRow(ticker) {
    const result = store.state.result;
    const rows = (result && result.rows) || [];
    for (const r of rows) {
      if (rowTicker(r) === ticker) return r;
    }
    return null;
  }

  function renderWatch() {
    wCount.textContent = String(watch.length);

    // Chips: every watched ticker with a remove control.
    wChips.innerHTML = '';
    if (!watch.length) {
      const empty = document.createElement('div');
      empty.className = 'sav-empty';
      empty.textContent = 'No tickers watched.';
      wChips.appendChild(empty);
    } else {
      for (const t of watch) {
        const chip = document.createElement('span');
        chip.className = 'sav-chip';
        const label = document.createElement('span');
        label.textContent = t;
        const x = document.createElement('span');
        x.className = 'sav-chip-x';
        x.textContent = '×'; // multiplication sign
        x.title = 'Remove';
        x.addEventListener('click', () => removeTicker(t));
        chip.appendChild(label);
        chip.appendChild(x);
        wChips.appendChild(chip);
      }
    }

    // Compact price/change rows for the starred tickers found in the result.
    wRows.innerHTML = '';
    if (!watchViewOn) return;
    const fieldIndex = store.state.fieldIndex || {};
    let any = false;
    for (const t of watch) {
      const row = findRow(t);
      if (!row) continue;
      any = true;
      const r = document.createElement('div');
      r.className = 'sav-watch-row';
      const tk = document.createElement('span');
      tk.className = 'sav-watch-tk';
      tk.textContent = t;
      const px = document.createElement('span');
      px.className = 'sav-watch-px';
      px.textContent = format.formatValue(row.close, fieldIndex.close);
      const ch = document.createElement('span');
      const chVal = typeof row.change === 'number' ? row.change : null;
      ch.className = 'sav-watch-ch' + (chVal > 0 ? ' pos' : chVal < 0 ? ' neg' : '');
      ch.textContent = format.formatValue(row.change, fieldIndex.change);
      r.appendChild(tk);
      r.appendChild(px);
      r.appendChild(ch);
      wRows.appendChild(r);
    }
    if (watchViewOn && watch.length && !any) {
      const empty = document.createElement('div');
      empty.className = 'sav-empty';
      empty.textContent = 'No watched tickers in the current result.';
      wRows.appendChild(empty);
    }
  }

  // ====================================================================
  //  TOPBAR ACTIONS: Watchlist toggle + CSV export
  // ====================================================================
  let watchViewOn = false;

  const topbar = el('topbar-actions');
  if (topbar) {
    // Clear the placeholder text the first time a topbar module mounts.
    const ph = el('topbar-actions-ph');
    if (ph) ph.remove();

    let group = topbar.querySelector('.sav-topbar');
    if (!group) {
      group = document.createElement('div');
      group.className = 'sav-topbar';
      topbar.appendChild(group);
    }

    const watchBtn = document.createElement('button');
    watchBtn.type = 'button';
    watchBtn.className = 'btn';
    watchBtn.textContent = 'Watchlist';
    watchBtn.title = 'Show price and change for watched tickers in the current result.';
    watchBtn.addEventListener('click', () => {
      watchViewOn = !watchViewOn;
      watchBtn.classList.toggle('is-on', watchViewOn);
      renderWatch();
    });
    group.appendChild(watchBtn);

    const csvBtn = document.createElement('button');
    csvBtn.type = 'button';
    csvBtn.className = 'btn';
    csvBtn.textContent = 'Export CSV';
    csvBtn.addEventListener('click', () => {
      const result = store.state.result;
      const hasRows = result && Array.isArray(result.rows) && result.rows.length;
      const hasCols = result && Array.isArray(result.columns) && result.columns.length;
      if (!hasRows || !hasCols) {
        window.Screener.toast('Nothing to export. Run a scan first.', {
          title: 'CSV export',
          kind: 'info',
        });
        return;
      }
      const csv = buildCsv(result);
      // Date.now / blob URL only created here, inside the handler.
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .slice(0, 19);
      const market = store.state.market || 'market';
      const filename = 'scanline-' + market + '-' + stamp + '.csv';
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      window.Screener.toast('Exported ' + result.rows.length + ' rows.', {
        title: 'CSV export',
        kind: 'ok',
      });
    });
    group.appendChild(csvBtn);
  } else {
    console.warn('saved: #topbar-actions not found, export and watchlist toggle skipped.');
  }

  // Re-render the watchlist view when a new result lands (so prices refresh).
  let lastResult = null;
  store.subscribe(() => {
    if (store.state.result !== lastResult) {
      lastResult = store.state.result;
      if (watchViewOn) renderWatch();
    }
  });

  // ---- Initial paint.
  renderScreens();
  renderWatch();
});
