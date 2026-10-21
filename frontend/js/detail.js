// detail.js. Wave 4 slice: row detail drawer, performance sparkline, auto-refresh.
//
// Three independent features, all wired through registerModule(init):
//   37. DETAIL DRAWER. Listens for 'screener:rowclick', slides a glass drawer
//       in from the right with the symbol header plus every field on the row,
//       grouped by store.state.fieldIndex group.
//   38. SPARKLINE. Builds a performance polyline from the multi-period
//       Perf.* fields present on the row (fetches them if absent), with a 0
//       baseline. Green stroke if last >= 0 else pink. renderSparkline() is
//       exported-by-attachment for reuse.
//   39. AUTO-REFRESH. Appends a toggle + interval select to #topbar-actions.
//       When on, setInterval calls store.runScreen() at the chosen cadence and
//       clears cleanly on toggle off, interval change, or module re-init.
//
// No em dashes anywhere. Styling lives in an injected <style id="detail-styles">
// using the .dtl- prefix and theme.css variables.

(function () {
  // ---- Perf fields, longest-to-shortest is the natural left-to-right axis.
  // Each entry: [fieldId, axis label]. We sample whichever exist on the row.
  const PERF_FIELDS = [
    ['Perf.W', 'W'],
    ['Perf.1M', '1M'],
    ['Perf.3M', '3M'],
    ['Perf.6M', '6M'],
    ['Perf.YTD', 'YTD'],
    ['Perf.Y', '1Y'],
  ];

  // =====================================================================
  //  STYLES
  // =====================================================================
  function injectStyles() {
    if (document.getElementById('detail-styles')) return;
    const style = document.createElement('style');
    style.id = 'detail-styles';
    style.textContent = `
.dtl-scrim {
  position: fixed;
  inset: 0;
  background: rgba(5, 5, 8, 0.5);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.22s ease;
  z-index: 900;
}
.dtl-scrim.open { opacity: 1; pointer-events: auto; }

.dtl-drawer {
  position: fixed;
  top: 0;
  right: 0;
  height: 100%;
  width: 400px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  background: var(--glass-strong);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-left: 2px solid var(--cyan);
  box-shadow: -8px 0 40px rgba(0, 0, 0, 0.55), var(--glow-cyan);
  transform: translateX(100%);
  transition: transform 0.26s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 901;
}
.dtl-scrim.open .dtl-drawer { transform: translateX(0); }

.dtl-head {
  position: relative;
  padding: var(--sp-4);
  border-bottom: 1px solid var(--line);
  flex: 0 0 auto;
}
.dtl-close {
  position: absolute;
  top: var(--sp-3);
  right: var(--sp-3);
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 0, 60, 0.06);
  border: 1px solid rgba(255, 0, 60, 0.32);
  border-radius: var(--radius-sm);
  color: var(--pink);
  font-family: var(--font-mono);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: box-shadow 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}
.dtl-close:hover {
  border-color: var(--pink);
  box-shadow: var(--glow-pink);
  background: rgba(255, 0, 60, 0.14);
}

.dtl-ticker {
  font-family: var(--font-mono);
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--cyan);
  padding-right: 34px;
  word-break: break-word;
}
.dtl-name {
  font-family: var(--font-ui);
  font-size: 12px;
  color: var(--muted);
  margin-top: 2px;
}
.dtl-pricerow {
  display: flex;
  align-items: baseline;
  gap: var(--sp-3);
  margin-top: var(--sp-3);
}
.dtl-price {
  font-family: var(--font-mono);
  font-size: 20px;
  font-weight: 600;
  color: var(--text);
}
.dtl-chg {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 600;
}
.dtl-chg.dtl-pos { color: var(--green); }
.dtl-chg.dtl-neg { color: var(--pink); }

.dtl-openin { margin-top: var(--sp-3); }

.dtl-spark {
  padding: var(--sp-3) var(--sp-4);
  border-bottom: 1px solid var(--line-soft);
  flex: 0 0 auto;
}
.dtl-spark-cap {
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
  font-weight: 600;
  margin-bottom: var(--sp-2);
}
.dtl-spark svg { display: block; width: 100%; height: auto; }

.dtl-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: var(--sp-3) var(--sp-4) var(--sp-4);
}
.dtl-group { margin-bottom: var(--sp-4); }
.dtl-group-title {
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--purple);
  font-weight: 700;
  padding-bottom: var(--sp-1);
  margin-bottom: var(--sp-2);
  border-bottom: 1px solid var(--line-soft);
}
.dtl-grid {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px var(--sp-3);
  align-items: baseline;
}
.dtl-k {
  font-family: var(--font-ui);
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dtl-v {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.dtl-v.dtl-pos { color: var(--green); }
.dtl-v.dtl-neg { color: var(--pink); }
.dtl-v.dtl-null { color: var(--muted); }

/* ---- Auto-refresh control (appended to #topbar-actions) ---- */
.dtl-refresh {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 4px 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: rgba(10, 10, 14, 0.6);
}
.dtl-refresh .dtl-rf-label {
  font-size: 12px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
  font-weight: 600;
}
.dtl-refresh select {
  padding: 3px 6px;
  background: rgba(10, 10, 14, 0.8);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12px;
  cursor: pointer;
  outline: none;
}
.dtl-refresh select:hover { border-color: rgba(0, 240, 255, 0.4); }
.dtl-rf-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--line);
  flex: 0 0 auto;
}
.dtl-refresh.active .dtl-rf-dot {
  background: var(--green);
  box-shadow: 0 0 8px var(--green);
  animation: dtl-pulse 1.1s ease-in-out infinite;
}
.dtl-refresh.active .dtl-rf-label { color: var(--green); }
@keyframes dtl-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.78); }
}
`;
    document.head.appendChild(style);
  }

  // =====================================================================
  //  SPARKLINE (feature 38)
  // =====================================================================
  // renderSparkline(values, opts) -> SVG string. Plots a polyline with a
  // baseline at 0. Stroke is green when the last value >= 0, pink otherwise.
  // opts: { width, height, pad, labels:[] }. Reusable in isolation.
  function renderSparkline(values, opts) {
    opts = opts || {};
    const w = opts.width || 340;
    const h = opts.height || 56;
    const pad = opts.pad != null ? opts.pad : 8;
    const labels = opts.labels || [];
    const nums = (values || []).map(Number).filter((v) => !Number.isNaN(v));
    if (!nums.length) return '';

    const last = nums[nums.length - 1];
    const stroke = last >= 0 ? 'var(--green)' : 'var(--pink)';

    // Domain spans the data and always includes 0 so the baseline is meaningful.
    let min = Math.min(0, ...nums);
    let max = Math.max(0, ...nums);
    if (min === max) { min -= 1; max += 1; }
    const innerW = w - pad * 2;
    const innerH = h - pad * 2;
    const n = nums.length;

    const xAt = (i) => pad + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
    const yAt = (v) => pad + innerH - ((v - min) / (max - min)) * innerH;

    // Single point: draw a small centered bar instead of a line.
    let path;
    if (n === 1) {
      const x = xAt(0);
      path = `<line x1="${x.toFixed(1)}" y1="${yAt(0).toFixed(1)}" x2="${x.toFixed(1)}" y2="${yAt(nums[0]).toFixed(1)}" stroke="${stroke}" stroke-width="3" stroke-linecap="round" />`;
    } else {
      const pts = nums.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
      const dots = nums
        .map((v, i) => `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(v).toFixed(1)}" r="2" fill="${stroke}" />`)
        .join('');
      path =
        `<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round" filter="url(#dtl-glow)" />` +
        dots;
    }

    const zeroY = yAt(0).toFixed(1);
    const baseline = `<line x1="${pad}" y1="${zeroY}" x2="${(w - pad).toFixed(1)}" y2="${zeroY}" stroke="var(--line)" stroke-width="1" stroke-dasharray="3 3" />`;

    let axis = '';
    if (labels.length === n) {
      axis = labels
        .map((lb, i) => {
          const x = xAt(i);
          const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
          return `<text x="${x.toFixed(1)}" y="${h - 1}" font-size="8" fill="var(--muted)" font-family="var(--font-mono)" text-anchor="${anchor}">${lb}</text>`;
        })
        .join('');
    }

    return (
      `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" role="img" aria-label="performance sparkline">` +
      `<defs><filter id="dtl-glow" x="-20%" y="-40%" width="140%" height="180%">` +
      `<feGaussianBlur stdDeviation="1.4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>` +
      baseline +
      path +
      axis +
      `</svg>`
    );
  }

  // Pull the perf points that already exist on the row. Returns
  // { values:[], labels:[] } sampling only present, numeric fields.
  function perfPointsFromRow(row) {
    const values = [];
    const labels = [];
    for (const [fid, lb] of PERF_FIELDS) {
      const v = row[fid];
      if (typeof v === 'number' && !Number.isNaN(v)) {
        values.push(v);
        labels.push(lb);
      }
    }
    return { values, labels };
  }

  // =====================================================================
  //  DRAWER (feature 37)
  // =====================================================================
  let scrim = null;
  let drawerEl = null;
  let ctxRef = null;
  let renderToken = 0; // guards async perf fetch against rapid re-clicks

  function ensureDrawer(host) {
    if (scrim) return;
    scrim = document.createElement('div');
    scrim.className = 'dtl-scrim';
    drawerEl = document.createElement('div');
    drawerEl.className = 'dtl-drawer';
    drawerEl.setAttribute('role', 'dialog');
    drawerEl.setAttribute('aria-label', 'row detail');
    scrim.appendChild(drawerEl);
    // Click on the scrim (outside the drawer) closes.
    scrim.addEventListener('click', (e) => {
      if (e.target === scrim) closeDrawer();
    });
    host.appendChild(scrim);
  }

  let returnFocus = null;

  function openDrawer(trigger) {
    if (!scrim) return;
    if (!isOpen()) returnFocus = trigger || document.activeElement;
    // Force a reflow so the transform transition runs from the closed state.
    void scrim.offsetWidth;
    scrim.classList.add('open');
    drawerEl.setAttribute('aria-modal', 'true');
    drawerEl.tabIndex = -1;
    drawerEl.focus({ preventScroll: true });
  }

  function closeDrawer() {
    if (!scrim || !scrim.classList.contains('open')) return;
    scrim.classList.remove('open');
    const target = returnFocus;
    returnFocus = null;
    if (target && target.isConnected && typeof target.focus === 'function') {
      target.focus({ preventScroll: true });
    }
  }

  function isOpen() {
    return scrim && scrim.classList.contains('open');
  }

  // Number-ish change value -> sign class.
  function signOf(v) {
    if (typeof v !== 'number' || Number.isNaN(v)) return '';
    return v > 0 ? 'dtl-pos' : v < 0 ? 'dtl-neg' : '';
  }

  // Build the dense, grouped field list for a row.
  function buildFieldGroups(row) {
    const { format, store } = ctxRef;
    const fieldIndex = store.state.fieldIndex || {};
    // Skip the keys already shown in the header.
    const SKIP = new Set(['name', 'description', 'ticker']);
    const groups = new Map(); // groupName -> [{label,value,meta,id}]
    const UNGROUPED = 'Other';

    for (const id of Object.keys(row)) {
      if (SKIP.has(id)) continue;
      const value = row[id];
      const meta = fieldIndex[id];
      const group = (meta && meta.group) || UNGROUPED;
      const label = (meta && meta.label) || id;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push({ id, label, value, meta });
    }

    const frag = document.createDocumentFragment();
    // Render known groups first (insertion order), with Other last.
    const names = [...groups.keys()].sort((a, b) => {
      if (a === UNGROUPED) return 1;
      if (b === UNGROUPED) return -1;
      return 0;
    });

    for (const gname of names) {
      const gWrap = document.createElement('div');
      gWrap.className = 'dtl-group';
      const gt = document.createElement('div');
      gt.className = 'dtl-group-title';
      gt.textContent = gname;
      gWrap.appendChild(gt);

      const grid = document.createElement('div');
      grid.className = 'dtl-grid';
      for (const item of groups.get(gname)) {
        const k = document.createElement('div');
        k.className = 'dtl-k';
        k.textContent = item.label;
        k.title = item.id;
        const vEl = document.createElement('div');
        vEl.className = 'dtl-v';
        if (item.value == null) {
          vEl.classList.add('dtl-null');
          vEl.textContent = '·';
        } else {
          vEl.textContent = format.formatValue(item.value, item.meta);
          const sc = format.signClass(item.value, item.meta, item.id);
          if (sc === 'sign-pos') vEl.classList.add('dtl-pos');
          else if (sc === 'sign-neg') vEl.classList.add('dtl-neg');
        }
        grid.appendChild(k);
        grid.appendChild(vEl);
      }
      gWrap.appendChild(grid);
      frag.appendChild(gWrap);
    }
    return frag;
  }

  function renderSparkSection(parent, points) {
    const sec = document.createElement('div');
    sec.className = 'dtl-spark';
    const cap = document.createElement('div');
    cap.className = 'dtl-spark-cap';
    cap.textContent = 'Performance';
    sec.appendChild(cap);
    const holder = document.createElement('div');
    holder.innerHTML = renderSparkline(points.values, { labels: points.labels });
    sec.appendChild(holder);
    parent.appendChild(sec);
  }

  // Render the whole drawer for a row. `points` may be supplied later by the
  // async perf fetch; pass null to draw the change-based fallback.
  function renderDrawer(row, points) {
    if (!drawerEl) return;
    const { format } = ctxRef;
    drawerEl.innerHTML = '';

    // ---- Header
    const head = document.createElement('div');
    head.className = 'dtl-head';

    const close = document.createElement('button');
    close.className = 'dtl-close';
    close.setAttribute('aria-label', 'close');
    close.textContent = '✕';
    close.addEventListener('click', closeDrawer);
    head.appendChild(close);

    const ticker = document.createElement('div');
    ticker.className = 'dtl-ticker';
    ticker.textContent = row.name || row.ticker || '?';
    head.appendChild(ticker);

    if (row.description) {
      const nm = document.createElement('div');
      nm.className = 'dtl-name';
      nm.textContent = row.description;
      head.appendChild(nm);
    }

    const priceRow = document.createElement('div');
    priceRow.className = 'dtl-pricerow';
    if (row.close != null) {
      const p = document.createElement('span');
      p.className = 'dtl-price';
      p.textContent = format.formatValue(row.close, ctxRef.store.state.fieldIndex.close);
      priceRow.appendChild(p);
    }
    if (typeof row.change === 'number') {
      const c = document.createElement('span');
      c.className = 'dtl-chg ' + signOf(row.change);
      c.textContent = format.pct(row.change);
      priceRow.appendChild(c);
    }
    if (priceRow.childNodes.length) head.appendChild(priceRow);

    // ---- Open in TradingView. A single link straight to the live chart.
    const openIn = window.Screener && window.Screener.openIn;
    if (openIn && openIn.mountButton) {
      const oiHost = document.createElement('div');
      oiHost.className = 'dtl-openin';
      head.appendChild(oiHost);
      openIn.mountButton(oiHost, row);
    }

    drawerEl.appendChild(head);

    // ---- Sparkline. Prefer supplied points, else read from row, else
    // fall back to a single-bar from `change`.
    let pts = points || perfPointsFromRow(row);
    if ((!pts.values || !pts.values.length) && typeof row.change === 'number') {
      pts = { values: [row.change], labels: ['CHG'] };
    }
    if (pts.values && pts.values.length) renderSparkSection(drawerEl, pts);

    // ---- All fields, grouped.
    const body = document.createElement('div');
    body.className = 'dtl-body';
    body.appendChild(buildFieldGroups(row));
    drawerEl.appendChild(body);
  }

  // If the row lacks perf fields, optionally fetch a richer single-symbol
  // detail. Resilient: any failure just skips and keeps the row render.
  async function maybeFetchPerf(row, token) {
    const present = perfPointsFromRow(row);
    if (present.values.length >= 2) return; // already enough on the row
    if (!row.name) return;
    const { api, store } = ctxRef;
    try {
      const body = {
        market: store.state.market,
        columns: PERF_FIELDS.map((p) => p[0]),
        filters: [{ field: 'name', op: '==', value: row.name }],
        limit: 1,
      };
      const resp = await api.screen(body);
      if (token !== renderToken) return; // a newer click superseded this one
      const hit = resp && resp.rows && resp.rows[0];
      if (!hit) return;
      const merged = Object.assign({}, row, hit);
      const pts = perfPointsFromRow(merged);
      if (pts.values.length) {
        if (!isOpen()) return;
        renderDrawer(merged, pts);
      }
    } catch (err) {
      // Skip the sparkline enrichment silently. The drawer still works.
      console.warn('detail: perf fetch skipped:', err && err.message);
    }
  }

  // The element focus should return to: the focused row, else the row by ticker.
  function rowTrigger(row) {
    const a = document.activeElement;
    if (a && a.tagName === 'TR') return a;
    const key = String(row.ticker || row.name || '').replace(/"/g, '\\"');
    return key ? document.querySelector('#table-host tr[data-ticker="' + key + '"]') : null;
  }

  function onRowClick(ev) {
    const row = ev.detail;
    if (!row || !ctxRef) return;
    renderToken += 1;
    const token = renderToken;
    renderDrawer(row, null);
    openDrawer(rowTrigger(row));
    maybeFetchPerf(row, token);
  }

  // =====================================================================
  //  AUTO-REFRESH (feature 39)
  // =====================================================================
  let timerId = null;

  function clearTimer() {
    if (timerId != null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function buildAutoRefresh(host) {
    // APPEND only. Never wipe existing siblings in #topbar-actions.
    const wrap = document.createElement('span');
    wrap.className = 'dtl-refresh';

    const dot = document.createElement('span');
    dot.className = 'dtl-rf-dot';

    const label = document.createElement('span');
    label.className = 'dtl-rf-label';
    label.textContent = 'Auto';

    const sel = document.createElement('select');
    sel.title = 'Auto-refresh interval';
    const options = [
      ['0', 'Off'],
      ['5', '5s'],
      ['15', '15s'],
      ['30', '30s'],
      ['60', '60s'],
    ];
    for (const [val, txt] of options) {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = txt;
      sel.appendChild(o);
    }

    function apply() {
      clearTimer();
      const secs = Number(sel.value);
      if (secs > 0) {
        wrap.classList.add('active');
        timerId = setInterval(() => {
          // Do not refresh while the user is mid-typing in a field.
          const a = document.activeElement;
          if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
          ctxRef.store.runScreen();
        }, secs * 1000);
      } else {
        wrap.classList.remove('active');
      }
    }

    sel.addEventListener('change', apply);

    wrap.appendChild(dot);
    wrap.appendChild(label);
    wrap.appendChild(sel);
    host.appendChild(wrap);
  }

  // =====================================================================
  //  ESC handler. Added exactly once across re-inits.
  // =====================================================================
  let escBound = false;
  function bindEscOnce() {
    if (escBound) return;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) closeDrawer();
    });
    escBound = true;
  }

  // Rowclick listener added once; relies on the module-level ctxRef.
  let clickBound = false;
  function bindRowClickOnce() {
    if (clickBound) return;
    document.addEventListener('screener:rowclick', onRowClick);
    clickBound = true;
  }

  // =====================================================================
  //  INIT
  // =====================================================================
  window.Screener.registerModule('detail', (ctx) => {
    ctxRef = ctx;
    injectStyles();

    // A re-init must not leak a previous auto-refresh interval.
    clearTimer();

    const drawerHost = ctx.el('drawer-host');
    if (!drawerHost) {
      console.warn('detail: #drawer-host missing, drawer disabled');
    } else {
      ensureDrawer(drawerHost);
      bindRowClickOnce();
      bindEscOnce();
    }

    const actionsHost = ctx.el('topbar-actions');
    if (!actionsHost) {
      console.warn('detail: #topbar-actions missing, auto-refresh disabled');
    } else {
      buildAutoRefresh(actionsHost);
    }
  });

  // Expose the sparkline renderer for reuse / testing.
  if (window.Screener) window.Screener.renderSparkline = renderSparkline;
})();
