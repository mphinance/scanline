// command-palette.js — Command palette (Ctrl/Cmd-K) + table keyboard nav.
//
// Two features, one module:
//
//  40) COMMAND PALETTE. Ctrl+K (Windows) / Cmd+K opens a centered glass modal
//      with a search box and a fuzzy-filtered command list. Commands are built
//      dynamically from the store: switch market, run preset, apply factor
//      model, plus a handful of actions (run scan, export CSV, clear filters,
//      focus filters). Arrow keys move the selection, Enter runs the highlighted
//      command, Esc or a click outside closes. Mouse hover selects.
//
//  41) TABLE KEYBOARD NAV. When the palette is closed and focus is not in an
//      input, ArrowDown / ArrowUp move a neon "selected row" highlight through
//      the visible #table-host rows, Home / End jump to first / last, and Enter
//      dispatches the same 'screener:rowclick' event table.js uses so the detail
//      drawer opens. The selected DOM row is mapped back to its data object by
//      matching the row's ticker text against store.state.result.rows, which is
//      resilient to any client-side reordering.
//
// Registers as module 'command-palette'. No em dashes anywhere.

function injectStyles() {
  if (document.getElementById('cmdk-styles')) return;
  const style = document.createElement('style');
  style.id = 'cmdk-styles';
  style.textContent = `
    .cmdk-backdrop {
      position: fixed;
      inset: 0;
      z-index: 2000;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 12vh;
      background: rgba(6, 6, 9, 0.55);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      animation: cmdk-fade 0.14s ease;
    }
    .cmdk-backdrop[hidden] { display: none; }
    @keyframes cmdk-fade { from { opacity: 0; } to { opacity: 1; } }

    .cmdk-modal {
      width: min(560px, 92vw);
      max-height: 70vh;
      display: flex;
      flex-direction: column;
      background: var(--glass-strong);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(0, 240, 255, 0.45);
      border-radius: var(--radius-lg);
      box-shadow: var(--glow-cyan), var(--shadow-soft);
      overflow: hidden;
      animation: cmdk-pop 0.16s ease;
    }
    @keyframes cmdk-pop {
      from { opacity: 0; transform: translateY(-8px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .cmdk-input {
      width: 100%;
      padding: 14px 16px;
      background: rgba(10, 10, 14, 0.6);
      border: none;
      border-bottom: 1px solid var(--line);
      color: var(--text);
      font-family: var(--font-ui);
      font-size: 15px;
      letter-spacing: 0.01em;
      outline: none;
    }
    .cmdk-input::placeholder { color: var(--muted); }

    .cmdk-list {
      list-style: none;
      margin: 0;
      padding: var(--sp-1);
      overflow-y: auto;
      min-height: 0;
    }
    .cmdk-item {
      display: flex;
      align-items: center;
      gap: var(--sp-2);
      padding: 9px 12px;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      cursor: pointer;
      font-family: var(--font-ui);
      font-size: 13px;
      color: var(--text);
    }
    .cmdk-item + .cmdk-item { margin-top: 2px; }
    .cmdk-item.is-active {
      border-color: rgba(0, 240, 255, 0.55);
      background: rgba(0, 240, 255, 0.08);
      box-shadow: var(--glow-cyan);
    }
    .cmdk-item.is-active .cmdk-label { color: var(--cyan); }
    .cmdk-cat {
      flex: 0 0 auto;
      min-width: 64px;
      font-family: var(--font-mono);
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .cmdk-label {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cmdk-ticker, .cmdk-mono { font-family: var(--font-mono); }
    .cmdk-empty {
      padding: 16px;
      text-align: center;
      color: var(--muted);
      font-size: 12px;
      letter-spacing: 0.03em;
    }
    .cmdk-foot {
      display: flex;
      gap: var(--sp-3);
      padding: 8px 14px;
      border-top: 1px solid var(--line);
      background: rgba(10, 10, 14, 0.4);
      font-size: 10px;
      color: var(--muted);
    }
    .cmdk-foot kbd {
      font-family: var(--font-mono);
      font-size: 10px;
      padding: 1px 5px;
      border: 1px solid var(--line);
      border-radius: 3px;
      color: var(--text);
      background: rgba(255, 255, 255, 0.04);
    }

    /* Table keyboard-nav selected row. */
    .screener-table tbody tr.kbd-selected td {
      background: rgba(0, 240, 255, 0.10);
      box-shadow: inset 0 0 0 9999px rgba(0, 240, 255, 0.04);
    }
    .screener-table tbody tr.kbd-selected {
      outline: 1px solid var(--cyan);
      outline-offset: -1px;
      box-shadow: var(--glow-cyan);
    }
  `;
  document.head.appendChild(style);
}

// Case-insensitive subsequence (fuzzy) match. Empty query matches everything.
function fuzzyMatch(query, text) {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

window.Screener.registerModule('command-palette', (ctx) => {
  const { store, el } = ctx;
  const toast = window.Screener.toast;

  // Guard against double init (global keydown listeners must register once).
  if (window.Screener._cmdkInit) return;
  window.Screener._cmdkInit = true;

  const host = el('command-palette-host');
  if (!host) {
    console.warn('command-palette: #command-palette-host not found, skipping.');
    return;
  }

  injectStyles();

  // Default columns per market, so a "switch market" command lands on a sane
  // column set rather than carrying over columns the new market lacks. The
  // store.setMarket call resets columns itself when given an array.
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

  // ---- Build the modal DOM once.
  const backdrop = document.createElement('div');
  backdrop.className = 'cmdk-backdrop';
  backdrop.hidden = true;

  const modal = document.createElement('div');
  modal.className = 'cmdk-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Command palette');

  const input = document.createElement('input');
  input.className = 'cmdk-input';
  input.type = 'text';
  input.placeholder = 'Type a command. Switch market, run preset, apply factor...';
  input.setAttribute('aria-label', 'Command search');

  const list = document.createElement('ul');
  list.className = 'cmdk-list';

  const foot = document.createElement('div');
  foot.className = 'cmdk-foot';
  foot.innerHTML =
    '<span><kbd>up</kbd><kbd>down</kbd> navigate</span>' +
    '<span><kbd>enter</kbd> run</span>' +
    '<span><kbd>esc</kbd> close</span>';

  modal.appendChild(input);
  modal.appendChild(list);
  modal.appendChild(foot);
  backdrop.appendChild(modal);
  host.appendChild(backdrop);

  // ---- Command set, rebuilt each open from the live store.
  let commands = [];      // full list
  let filtered = [];      // current visible subset
  let activeIndex = 0;    // selection within filtered

  function buildCommands() {
    const cmds = [];
    const s = store.state;

    // Markets.
    for (const m of s.markets || []) {
      cmds.push({
        cat: 'Market',
        label: 'Switch to ' + (m.label || m.id),
        run: () => {
          store.setMarket(m.id, defaultColumns(m.id));
          toast('Switched to ' + (m.label || m.id), { title: 'Market', kind: 'info' });
        },
      });
    }

    // Presets.
    for (const p of s.presets || []) {
      cmds.push({
        cat: 'Preset',
        label: 'Run preset: ' + (p.name || p.id),
        run: () => {
          const market = p.market || store.state.market;
          let columns = Array.isArray(p.columns) ? p.columns.slice() : null;
          if (!columns || !columns.length) columns = defaultColumns(market);
          store.set({
            market,
            columns,
            filters: Array.isArray(p.filters) ? p.filters.slice() : [],
            match: p.match || 'all',
            sort: Array.isArray(p.sort) ? p.sort.slice() : [],
            factor: null,
            computed: [],
            stats: [],
          });
          store.runScreen();
          toast('Running preset: ' + (p.name || p.id), { title: 'Preset', kind: 'info' });
        },
      });
    }

    // Factor models.
    for (const fp of s.factorPresets || []) {
      if (!fp.weights || !fp.weights.length) continue;
      cmds.push({
        cat: 'Factor',
        label: 'Apply factor: ' + (fp.name || fp.id),
        run: () => {
          store.set({ factor: { weights: fp.weights.slice() } });
          store.runScreen();
          toast('Applied factor model: ' + (fp.name || fp.id), { title: 'Factor', kind: 'info' });
        },
      });
    }

    // Actions.
    cmds.push({
      cat: 'Action',
      label: 'Run scan',
      run: () => store.runScreen(),
    });
    cmds.push({
      cat: 'Action',
      label: 'Export CSV',
      run: () => {
        // saved.js may listen for this; fall back to a toast if nothing does.
        let handled = false;
        const ev = new CustomEvent('neon:export-csv', {
          cancelable: true,
          detail: { ack: () => { handled = true; } },
        });
        const notPrevented = document.dispatchEvent(ev);
        if (!handled && notPrevented) {
          toast('No export handler is loaded yet.', { title: 'Export CSV', kind: 'err' });
        }
      },
    });
    cmds.push({
      cat: 'Action',
      label: 'Clear filters',
      run: () => {
        store.set({ filters: [] });
        store.runScreen();
        toast('Filters cleared', { title: 'Filters', kind: 'info' });
      },
    });
    cmds.push({
      cat: 'Action',
      label: 'Focus filters',
      run: () => {
        const panel = el('filter-panel');
        if (panel && panel.scrollIntoView) {
          panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      },
    });

    return cmds;
  }

  // ---- Render the filtered list and keep the active item visible.
  function renderList() {
    list.innerHTML = '';
    if (!filtered.length) {
      const empty = document.createElement('li');
      empty.className = 'cmdk-empty';
      empty.textContent = 'No matching commands.';
      list.appendChild(empty);
      return;
    }
    filtered.forEach((cmd, i) => {
      const li = document.createElement('li');
      li.className = 'cmdk-item' + (i === activeIndex ? ' is-active' : '');
      li.dataset.index = String(i);

      const cat = document.createElement('span');
      cat.className = 'cmdk-cat';
      cat.textContent = cmd.cat;

      const label = document.createElement('span');
      label.className = 'cmdk-label';
      label.textContent = cmd.label;

      li.appendChild(cat);
      li.appendChild(label);

      li.addEventListener('mousemove', () => {
        if (activeIndex !== i) {
          activeIndex = i;
          updateActive();
        }
      });
      li.addEventListener('click', () => {
        activeIndex = i;
        runActive();
      });

      list.appendChild(li);
    });
  }

  // Cheap active-class update without a full re-render (used by hover/arrows).
  function updateActive() {
    const items = list.querySelectorAll('.cmdk-item');
    items.forEach((node, i) => {
      const on = i === activeIndex;
      node.classList.toggle('is-active', on);
      if (on && node.scrollIntoView) node.scrollIntoView({ block: 'nearest' });
    });
  }

  function applyQuery() {
    const q = input.value.trim();
    filtered = commands.filter((c) => fuzzyMatch(q, c.cat + ' ' + c.label));
    activeIndex = 0;
    renderList();
  }

  function runActive() {
    const cmd = filtered[activeIndex];
    if (!cmd) return;
    closePalette();
    try {
      cmd.run();
    } catch (err) {
      console.error('command-palette: command failed:', err);
      if (toast) toast(String(err.message || err), { title: 'Command failed', kind: 'err' });
    }
  }

  // ---- Open / close.
  let isOpen = false;

  function openPalette() {
    if (isOpen) return;
    commands = buildCommands();
    input.value = '';
    applyQuery();
    backdrop.hidden = false;
    host.classList.add('open'); // layout.css gates host visibility on .open
    isOpen = true;
    // Focus after the element is visible so the cursor lands in the field.
    requestAnimationFrame(() => input.focus());
  }

  function closePalette() {
    if (!isOpen) return;
    backdrop.hidden = true;
    host.classList.remove('open');
    isOpen = false;
  }

  // Click outside the modal closes.
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) closePalette();
  });

  input.addEventListener('input', applyQuery);

  // Key handling while the palette is open lives on the input.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filtered.length) {
        activeIndex = (activeIndex + 1) % filtered.length;
        updateActive();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filtered.length) {
        activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
        updateActive();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runActive();
    }
  });

  // =====================================================================
  //  TABLE KEYBOARD NAV
  // =====================================================================
  let selectedRow = null; // the live tbody <tr> currently highlighted

  function tableRows() {
    const tableHost = el('table-host');
    if (!tableHost) return [];
    return Array.from(tableHost.querySelectorAll('tbody tr'));
  }

  function clearSelection() {
    if (selectedRow) selectedRow.classList.remove('kbd-selected');
    selectedRow = null;
  }

  function selectRowAt(index) {
    const rows = tableRows();
    if (!rows.length) return;
    let i = index;
    if (i < 0) i = 0;
    if (i > rows.length - 1) i = rows.length - 1;
    if (selectedRow) selectedRow.classList.remove('kbd-selected');
    selectedRow = rows[i];
    selectedRow.classList.add('kbd-selected');
    if (selectedRow.scrollIntoView) selectedRow.scrollIntoView({ block: 'nearest' });
  }

  function currentIndex() {
    const rows = tableRows();
    return selectedRow ? rows.indexOf(selectedRow) : -1;
  }

  // Map a DOM row back to its data object. table.js stamps each row with
  // data-ticker (row.ticker || row.name); match that against result.rows so the
  // mapping survives any client-side reordering of the tbody.
  function rowDataFor(tr) {
    if (!tr) return null;
    const key = tr.dataset.ticker || '';
    const rows = (store.state.result && store.state.result.rows) || [];
    if (key) {
      const hit = rows.find((r) => (r.ticker || r.name || '') === key);
      if (hit) return hit;
    }
    // Fallback: read the first visible cell (the name column) and match by name.
    const firstCell = tr.querySelector('td');
    const text = firstCell ? firstCell.textContent.trim() : '';
    if (text) {
      const hit = rows.find((r) => String(r.name || '').trim() === text);
      if (hit) return hit;
    }
    return null;
  }

  function openSelectedRow() {
    const data = rowDataFor(selectedRow);
    if (data) {
      document.dispatchEvent(new CustomEvent('screener:rowclick', { detail: data }));
    }
  }

  // When a fresh result renders, any prior selection is gone from the DOM.
  store.subscribe(() => {
    if (selectedRow && !selectedRow.isConnected) selectedRow = null;
  });

  // ---- Is the user typing somewhere we must not hijack keys?
  function inEditable(target) {
    if (!target) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return false;
  }

  // ---- Single global keydown: opens the palette and drives table nav.
  window.addEventListener('keydown', (e) => {
    // Ctrl+K (Windows) / Cmd+K toggles the palette. preventDefault so the
    // browser does not steer focus to the address bar.
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (isOpen) closePalette();
      else openPalette();
      return;
    }

    // Everything below is table nav, which is suppressed while the palette is
    // open or while the user types in a field.
    if (isOpen) return;
    if (inEditable(e.target)) return;

    switch (e.key) {
      case 'ArrowDown': {
        const rows = tableRows();
        if (!rows.length) return;
        e.preventDefault();
        selectRowAt(currentIndex() + 1);
        break;
      }
      case 'ArrowUp': {
        const rows = tableRows();
        if (!rows.length) return;
        e.preventDefault();
        const idx = currentIndex();
        selectRowAt(idx < 0 ? 0 : idx - 1);
        break;
      }
      case 'Home': {
        const rows = tableRows();
        if (!rows.length) return;
        e.preventDefault();
        selectRowAt(0);
        break;
      }
      case 'End': {
        const rows = tableRows();
        if (!rows.length) return;
        e.preventDefault();
        selectRowAt(rows.length - 1);
        break;
      }
      case 'Enter': {
        if (!selectedRow) return;
        e.preventDefault();
        openSelectedRow();
        break;
      }
      case 'Escape': {
        if (selectedRow) {
          e.preventDefault();
          clearSelection();
        }
        break;
      }
      default:
        break;
    }
  });
});
