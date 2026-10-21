// table.js - the dense neon data table plus its client-side analytics powers.
//
// renderTable(container, result, fieldsIndex)
//   container   the #table-host element
//   result      {count, rows, columns, meta} from /api/screen
//   fieldsIndex map of fieldId -> {id,label,group,type,unit}
//
// Beyond a static render this module maintains an internal VIEW over the raw
// result rows: multi-key sort, per-column filters, a summary-stat footer, and
// conditional formatting (sign coloring + per-column heatmap). All of it is
// client-side and operates on the current result set, no server round-trip.
//
// One source of truth: raw rows come from result.rows. View state lives on the
// TableView instance (sortKeys, colFilters, heatmapCols). computeView(raw)
// applies filters then a stable, numeric-aware sort and returns visible rows.
//
// Row click still dispatches a global 'screener:rowclick' CustomEvent with the
// row object so the detail drawer keeps working. The name column stays sticky.
//
// Exports TableView (the stateful view) and renderTable (one-shot convenience).

import { formatValue, isNumericType, signClass } from './format.js';
import store from './state.js';

// Inject the small set of drag-and-drop styles this module needs. table.css is
// not in our lane, so header drag visuals live here. Reuses theme.css vars.
const DRAGDROP_STYLE = `
.screener-table thead th[draggable="true"] { cursor: grab; }
.screener-table thead th.th-dragging { opacity: 0.45; cursor: grabbing; }
.screener-table thead th.th-drop-before { box-shadow: inset 2px 0 0 0 var(--cyan); }
.screener-table thead th.th-drop-after { box-shadow: inset -2px 0 0 0 var(--cyan); }
`;
function injectDragDropStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dragdrop-styles')) return;
  const tag = document.createElement('style');
  tag.id = 'dragdrop-styles';
  tag.textContent = DRAGDROP_STYLE;
  document.head.appendChild(tag);
}

// Columns we never want to show as their own cell. The backend always returns
// "ticker" (exchange-prefixed) first; we surface "name" as the primary symbol
// and keep "ticker" only as a data attribute for the detail drawer.
const HIDDEN_COLUMNS = new Set(['ticker']);

// Non-numeric catalog ids that have no field meta but are clearly strings.
const STRING_FALLBACK = new Set([
  'name', 'description', 'sector', 'industry', 'exchange', 'country', 'currency', 'type',
]);

// Derived / computed numeric column id patterns (no catalog entry, numeric).
const DERIVED_NUMERIC_RE = /^(zscore|pctrank|rank|norm)\(/;

function labelFor(colId, fieldsIndex) {
  const meta = fieldsIndex[colId];
  if (meta && meta.label) return meta.label;
  // Stat / computed / factor columns have no catalog entry. Use the id.
  return colId;
}

// Decide whether a column should be treated as numeric for align / sort /
// filter / stats. Uses the catalog type when present, then known derived
// patterns, else falls back to the string list.
function isNumericCol(colId, fieldsIndex) {
  if (colId === 'name') return false;
  const meta = fieldsIndex[colId];
  if (meta && meta.type) return isNumericType(meta.type);
  if (DERIVED_NUMERIC_RE.test(colId)) return true;
  if (colId === 'factor_score') return true;
  if (STRING_FALLBACK.has(colId)) return false;
  // Unknown computed id: assume numeric (matches format.js fallback).
  return true;
}

// Coerce a raw cell value to a number for numeric sort / filter / stats.
// Returns null when not a usable number.
function toNumber(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isNaN(v) ? null : v;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// ---- Pure stats over an array of numbers (nulls already removed). ----
function computeStats(nums) {
  const count = nums.length;
  if (!count) return { count: 0, mean: null, median: null, min: null, max: null, stdev: null, sum: null };
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const n of nums) {
    sum += n;
    if (n < min) min = n;
    if (n > max) max = n;
  }
  const mean = sum / count;
  let variance = 0;
  for (const n of nums) variance += (n - mean) * (n - mean);
  // Sample stdev (n-1); fall back to 0 for a single value.
  const stdev = count > 1 ? Math.sqrt(variance / (count - 1)) : 0;
  const sorted = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { count, mean, median, min, max, stdev, sum };
}

const STAT_ROWS = ['count', 'mean', 'median', 'min', 'max', 'stdev', 'sum'];
const STAT_LABELS = {
  count: 'COUNT', mean: 'MEAN', median: 'MEDIAN', min: 'MIN',
  max: 'MAX', stdev: 'STDEV', sum: 'SUM',
};

// Column stats are collapsed on first run; the choice persists per browser.
const STATS_OPEN_KEY = 'scanline.statsOpen';
function loadStatsOpen() {
  try {
    return localStorage.getItem(STATS_OPEN_KEY) === '1';
  } catch (err) {
    return false;
  }
}
function saveStatsOpen(open) {
  try {
    localStorage.setItem(STATS_OPEN_KEY, open ? '1' : '0');
  } catch (err) {
    // Not fatal.
  }
}

// One-shot render: convenience wrapper that draws a fresh stateless view.
export function renderTable(container, result, fieldsIndex) {
  const view = new TableView(container, fieldsIndex);
  view.render(result);
  return view;
}

function emptyCard(result) {
  const wrap = document.createElement('div');
  wrap.className = 'empty-card';
  const err = result && result.meta && result.meta.error;
  const title = document.createElement('div');
  title.className = 'empty-title';
  title.textContent = err ? 'SCAN FAILED' : 'NO MATCHES';
  const body = document.createElement('div');
  body.textContent = err
    ? String(err)
    : 'No rows came back for this scan. Loosen the filters or pick another market.';
  wrap.appendChild(title);
  wrap.appendChild(body);
  if (err) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-primary';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => document.dispatchEvent(new CustomEvent('screener:retry')));
    wrap.appendChild(retry);
  }
  return wrap;
}

// Stateful view: owns the container + fieldsIndex AND the analytics view state
// (sort keys, per-column filters, heatmap columns). Modules call
// view.render(result) repeatedly; preferences survive new results as long as
// the referenced columns still exist.
export class TableView {
  constructor(container, fieldsIndex) {
    injectDragDropStyles();
    this.container = container;
    this.fieldsIndex = fieldsIndex || {};

    // Set true on a header dragstart, cleared after the click that follows a
    // drop fires. Lets _onHeaderClick tell a reorder-drag from a sort-click.
    this._didReorderDrag = false;

    // ---- View state (single source of truth for the powers) ----
    this.result = null;                // last result object {count, rows, columns, meta}
    this.columns = [];                 // visible column ids (ticker filtered out)
    this.sortKeys = [];                // [{col, dir:'asc'|'desc'}], priority order
    this.colFilters = {};              // colId -> {text} | {min, max}
    this.heatmapCols = new Set();      // colIds painted as a gradient
    this.filterRowOpen = false;        // is the per-column filter row visible
    this.statMode = 'all';             // 'all' (every stat row) or one of STAT_ROWS

    this._filterDebounce = null;       // debounce timer for filter inputs
  }

  setFieldsIndex(fieldsIndex) {
    this.fieldsIndex = fieldsIndex || {};
  }

  isNumeric(colId) {
    return isNumericCol(colId, this.fieldsIndex);
  }

  // Drop sort keys / filters / heatmap entries that reference columns no longer
  // present after a new result lands.
  _reconcileToColumns(cols) {
    const colSet = new Set(cols);
    this.sortKeys = this.sortKeys.filter((k) => colSet.has(k.col));
    for (const id of Object.keys(this.colFilters)) {
      if (!colSet.has(id)) delete this.colFilters[id];
    }
    for (const id of [...this.heatmapCols]) {
      if (!colSet.has(id)) this.heatmapCols.delete(id);
    }
  }

  // ---- The view pipeline: filter then stable, numeric-aware sort. ----
  computeView(rawRows) {
    let rows = rawRows;

    // 1. Filters (AND across columns).
    const active = Object.entries(this.colFilters).filter(([, f]) => {
      if (!f) return false;
      if (f.text != null && f.text !== '') return true;
      if (f.min != null && f.min !== '') return true;
      if (f.max != null && f.max !== '') return true;
      return false;
    });
    if (active.length) {
      rows = rows.filter((row) => {
        for (const [colId, f] of active) {
          if (this.isNumeric(colId)) {
            const n = toNumber(row[colId]);
            if (f.min != null && f.min !== '') {
              if (n == null || n < Number(f.min)) return false;
            }
            if (f.max != null && f.max !== '') {
              if (n == null || n > Number(f.max)) return false;
            }
          } else {
            const needle = String(f.text || '').toLowerCase();
            const hay = row[colId] == null ? '' : String(row[colId]).toLowerCase();
            if (!hay.includes(needle)) return false;
          }
        }
        return true;
      });
    }

    // 2. Stable, numeric-aware multi-key sort. None/null sort last regardless
    //    of direction. Decorate-sort-undecorate keeps it stable.
    if (this.sortKeys.length) {
      const keys = this.sortKeys;
      const decorated = rows.map((row, i) => ({ row, i }));
      decorated.sort((a, b) => {
        for (const key of keys) {
          const numeric = this.isNumeric(key.col);
          const cmp = this._compareCell(a.row[key.col], b.row[key.col], numeric, key.dir);
          if (cmp !== 0) return cmp;
        }
        return a.i - b.i; // stable tiebreak
      });
      rows = decorated.map((d) => d.row);
    }

    return rows;
  }

  // Compare two cell values. Nulls always sort last (after non-nulls) no matter
  // the direction. dir flips the comparison of present values only.
  _compareCell(av, bv, numeric, dir) {
    const aNull = av == null || av === '';
    const bNull = bv == null || bv === '';
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    let cmp;
    if (numeric) {
      const an = toNumber(av);
      const bn = toNumber(bv);
      if (an == null && bn == null) return 0;
      if (an == null) return 1;
      if (bn == null) return -1;
      cmp = an - bn;
    } else {
      cmp = String(av).localeCompare(String(bv));
    }
    return dir === 'desc' ? -cmp : cmp;
  }

  // ---- Sort interaction: plain click cycles a single key asc->desc->none.
  //      Shift-click adds / advances a secondary/tertiary key. ----
  // Reorder the screen's columns by drag: move draggedId before/after targetId,
  // write the new order to the store, and rerun. Reorders only, never removes,
  // so 'name' survives. No-op when the order is unchanged.
  _reorderColumns(draggedId, targetId, after) {
    const cols = store.state.columns.slice();
    const from = cols.indexOf(draggedId);
    if (from < 0 || draggedId === targetId) return;
    cols.splice(from, 1);
    const t = cols.indexOf(targetId);
    if (t < 0) return;
    const insertAt = after ? t + 1 : t;
    cols.splice(insertAt, 0, draggedId);
    if (cols.join('') === store.state.columns.join('')) return;
    store.set({ columns: cols });
    store.runScreen();
  }

  _onHeaderClick(colId, shiftKey) {
    // A reorder drag ends with a synthetic click on some browsers. Swallow that
    // one click so a drag never triggers a sort.
    if (this._didReorderDrag) {
      this._didReorderDrag = false;
      return;
    }
    const existingIdx = this.sortKeys.findIndex((k) => k.col === colId);
    if (shiftKey) {
      if (existingIdx === -1) {
        this.sortKeys.push({ col: colId, dir: 'asc' });
      } else {
        const k = this.sortKeys[existingIdx];
        if (k.dir === 'asc') k.dir = 'desc';
        else this.sortKeys.splice(existingIdx, 1); // asc->desc->remove
      }
    } else {
      // Single-key: collapse to just this column, cycling its direction.
      if (existingIdx !== -1 && this.sortKeys.length === 1) {
        const k = this.sortKeys[0];
        if (k.dir === 'asc') k.dir = 'desc';
        else this.sortKeys = []; // asc->desc->none
      } else {
        this.sortKeys = [{ col: colId, dir: 'asc' }];
      }
    }
    this._rerender();
  }

  _toggleHeatmap(colId) {
    if (this.heatmapCols.has(colId)) this.heatmapCols.delete(colId);
    else this.heatmapCols.add(colId);
    this._rerender();
  }

  _setFilter(colId, patch) {
    const cur = this.colFilters[colId] || {};
    this.colFilters[colId] = { ...cur, ...patch };
    // Debounce so typing stays smooth on ~300 rows.
    clearTimeout(this._filterDebounce);
    this._filterDebounce = setTimeout(() => this._rerender(), 120);
  }

  // Re-render keeping the same result (used after an interaction).
  _rerender() {
    if (this.result) this._draw();
  }

  // Public entry: app.js calls this when the result changes.
  render(result) {
    this.result = result;
    const cols = (result && result.columns) || [];
    this.columns = cols.filter((c) => !HIDDEN_COLUMNS.has(c));
    this._reconcileToColumns(this.columns);
    this._draw();
  }

  // ---- The actual DOM build, from current view state. ----
  _draw() {
    const container = this.container;
    if (!container) return;
    container.innerHTML = '';

    const result = this.result;
    const rawRows = (result && result.rows) || [];

    if (!rawRows.length) {
      container.appendChild(emptyCard(result));
      this._renderFooter([], []);
      return;
    }

    const visible = this.computeView(rawRows);

    container.appendChild(this._buildToolbar(visible.length, rawRows.length));

    const table = document.createElement('table');
    table.className = 'screener-table';
    table.appendChild(this._buildHeader());
    table.appendChild(this._buildBody(visible));
    container.appendChild(table);

    this._renderFooter(visible, this.columns);
  }

  // Thin in-host toolbar: funnel toggle for the filter row + visible/total count.
  _buildToolbar(visibleCount, totalCount) {
    const bar = document.createElement('div');
    bar.className = 'table-powerbar';

    const funnel = document.createElement('button');
    funnel.type = 'button';
    funnel.className = 'tp-btn' + (this.filterRowOpen ? ' is-on' : '');
    funnel.title = 'Toggle per-column filters';
    funnel.innerHTML = '✇ Filter';
    funnel.addEventListener('click', () => {
      this.filterRowOpen = !this.filterRowOpen;
      this._rerender();
    });
    bar.appendChild(funnel);

    const count = document.createElement('span');
    count.className = 'tp-count';
    count.textContent = `${visibleCount} / ${totalCount} rows`;
    bar.appendChild(count);

    if (this.sortKeys.length) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'tp-btn';
      clear.textContent = 'Clear sort';
      clear.addEventListener('click', () => { this.sortKeys = []; this._rerender(); });
      bar.appendChild(clear);
    }

    return bar;
  }

  _buildHeader() {
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    for (const colId of this.columns) {
      const th = document.createElement('th');
      const numeric = this.isNumeric(colId);
      if (numeric) th.classList.add('num');
      if (colId === 'name') th.classList.add('col-name');
      th.dataset.col = colId;
      th.title = colId + '  (click sort, shift-click add key)';

      const labelWrap = document.createElement('span');
      labelWrap.className = 'th-label';
      labelWrap.textContent = labelFor(colId, this.fieldsIndex);
      th.appendChild(labelWrap);

      // Sort badge: priority number + direction arrow.
      const sortIdx = this.sortKeys.findIndex((k) => k.col === colId);
      if (sortIdx !== -1) {
        th.classList.add('is-sorted');
        const key = this.sortKeys[sortIdx];
        const badge = document.createElement('span');
        badge.className = 'sort-badge';
        const arrow = key.dir === 'asc' ? '▲' : '▼';
        // Only show a priority number when multi-key.
        const prio = this.sortKeys.length > 1 ? String(sortIdx + 1) : '';
        badge.textContent = prio ? `${prio}${arrow}` : arrow;
        th.appendChild(badge);
      }

      // Heatmap toggle (numeric only). Small icon; reflects active state.
      if (numeric) {
        const heat = document.createElement('span');
        heat.className = 'heat-toggle' + (this.heatmapCols.has(colId) ? ' is-on' : '');
        heat.title = 'Toggle heatmap for this column';
        heat.textContent = '▦';
        heat.addEventListener('click', (e) => {
          e.stopPropagation();
          this._toggleHeatmap(colId);
        });
        th.appendChild(heat);
      }

      // Drag-and-drop reorder. Dragging the th body reorders columns; a plain
      // click still sorts (the dragstart sets a flag the click handler honors).
      // We only enable dragging when there is more than one column to move.
      if (this.columns.length > 1) {
        th.draggable = true;
        th.addEventListener('dragstart', (e) => {
          this._didReorderDrag = true;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', colId);
          th.classList.add('th-dragging');
        });
        th.addEventListener('dragend', () => {
          th.classList.remove('th-dragging');
          this._clearHeaderDropMarks();
        });
        th.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const before = this._isBeforeHalfX(e, th);
          this._clearHeaderDropMarks();
          th.classList.add(before ? 'th-drop-before' : 'th-drop-after');
        });
        th.addEventListener('dragleave', () => {
          th.classList.remove('th-drop-before', 'th-drop-after');
        });
        th.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const draggedId = e.dataTransfer.getData('text/plain');
          const after = !this._isBeforeHalfX(e, th);
          this._clearHeaderDropMarks();
          if (draggedId) this._reorderColumns(draggedId, colId, after);
        });
      }

      th.addEventListener('click', (e) => this._onHeaderClick(colId, e.shiftKey));
      // Right-click a header is a fast heatmap toggle for numeric columns.
      th.addEventListener('contextmenu', (e) => {
        if (!numeric) return;
        e.preventDefault();
        this._toggleHeatmap(colId);
      });
      tr.appendChild(th);
    }
    thead.appendChild(tr);

    if (this.filterRowOpen) thead.appendChild(this._buildFilterRow());
    return thead;
  }

  // Clear column drop indicators across the header row.
  _clearHeaderDropMarks() {
    if (!this.container) return;
    this.container.querySelectorAll('.th-drop-before, .th-drop-after').forEach((n) => {
      n.classList.remove('th-drop-before', 'th-drop-after');
    });
  }

  // Is the pointer in the left half of the th (drop before) vs right (after)?
  _isBeforeHalfX(e, th) {
    const rect = th.getBoundingClientRect();
    return (e.clientX - rect.left) < rect.width / 2;
  }

  _buildFilterRow() {
    const tr = document.createElement('tr');
    tr.className = 'filter-row';
    for (const colId of this.columns) {
      const th = document.createElement('th');
      if (colId === 'name') th.classList.add('col-name');
      const numeric = this.isNumeric(colId);
      const f = this.colFilters[colId] || {};
      if (numeric) {
        th.classList.add('num');
        const wrap = document.createElement('div');
        wrap.className = 'fr-range';
        const min = document.createElement('input');
        min.className = 'fr-input';
        min.type = 'number';
        min.placeholder = 'min';
        min.value = f.min != null ? f.min : '';
        min.addEventListener('input', () => this._setFilter(colId, { min: min.value }));
        const max = document.createElement('input');
        max.className = 'fr-input';
        max.type = 'number';
        max.placeholder = 'max';
        max.value = f.max != null ? f.max : '';
        max.addEventListener('input', () => this._setFilter(colId, { max: max.value }));
        wrap.appendChild(min);
        wrap.appendChild(max);
        th.appendChild(wrap);
      } else {
        const text = document.createElement('input');
        text.className = 'fr-input';
        text.type = 'text';
        text.placeholder = 'contains';
        text.value = f.text != null ? f.text : '';
        text.addEventListener('input', () => this._setFilter(colId, { text: text.value }));
        th.appendChild(text);
      }
      // Keep clicks inside inputs from triggering header sort.
      th.addEventListener('click', (e) => e.stopPropagation());
      tr.appendChild(th);
    }
    return tr;
  }

  // Precompute per-column min/max over visible rows for heatmap scaling.
  _heatRanges(rows) {
    const ranges = {};
    for (const colId of this.heatmapCols) {
      if (!this.isNumeric(colId)) continue;
      let min = Infinity;
      let max = -Infinity;
      for (const row of rows) {
        const n = toNumber(row[colId]);
        if (n == null) continue;
        if (n < min) min = n;
        if (n > max) max = n;
      }
      if (min !== Infinity) ranges[colId] = { min, max };
    }
    return ranges;
  }

  // Map a value in [min,max] to a visible gradient: neon pink (low) through a
  // dim neutral (mid) to neon green (high). Every cell is clearly tinted: alpha
  // floors at ~0.18 at the midpoint and rises to ~0.42 at the extremes, so the
  // heatmap reads across the whole column while text stays legible.
  _heatColor(value, min, max) {
    // Flat column (or single row): uniform faint neutral, no divide by zero.
    if (max === min) return 'rgba(176, 38, 255, 0.18)';

    let t = (value - min) / (max - min); // 0..1
    if (t < 0) t = 0;
    else if (t > 1) t = 1;

    // Alpha: floor 0.18 at the midpoint, up to 0.42 at either extreme.
    const A_MID = 0.18;
    const A_EDGE = 0.42;
    const edge = Math.abs(t - 0.5) / 0.5; // 0 at mid, 1 at extremes
    const alpha = A_MID + (A_EDGE - A_MID) * edge;

    // Endpoint colors. The neutral mid sits between them so the hue eases
    // through a dim grey rather than snapping pink-to-green.
    const PINK = [255, 0, 60];
    const NEUTRAL = [140, 140, 150];
    const GREEN = [0, 255, 136];

    let r;
    let g;
    let b;
    if (t < 0.5) {
      const k = t / 0.5; // pink -> neutral
      r = Math.round(PINK[0] + (NEUTRAL[0] - PINK[0]) * k);
      g = Math.round(PINK[1] + (NEUTRAL[1] - PINK[1]) * k);
      b = Math.round(PINK[2] + (NEUTRAL[2] - PINK[2]) * k);
    } else {
      const k = (t - 0.5) / 0.5; // neutral -> green
      r = Math.round(NEUTRAL[0] + (GREEN[0] - NEUTRAL[0]) * k);
      g = Math.round(NEUTRAL[1] + (GREEN[1] - NEUTRAL[1]) * k);
      b = Math.round(NEUTRAL[2] + (GREEN[2] - NEUTRAL[2]) * k);
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  }

  _buildBody(rows) {
    const tbody = document.createElement('tbody');
    const heatRanges = this._heatRanges(rows);

    rows.forEach((row) => {
      const tr = document.createElement('tr');
      tr.dataset.ticker = row.ticker || row.name || '';
      for (const colId of this.columns) {
        const td = document.createElement('td');
        const meta = this.fieldsIndex[colId];
        const value = row[colId];
        const numeric = typeof value === 'number' || this.isNumeric(colId);

        if (colId === 'name') {
          td.classList.add('col-name');
        } else if (numeric) {
          td.classList.add('num');
          const sc = signClass(value, meta, colId);
          if (sc) td.classList.add(sc);
        } else {
          td.classList.add('str');
        }

        if (value == null) td.classList.add('is-null');
        td.textContent = value == null ? '·' : formatValue(value, meta);

        // Heatmap background (low-alpha so sign / text stays readable).
        const range = heatRanges[colId];
        if (range) {
          const n = toNumber(value);
          if (n != null) {
            td.classList.add('heat-cell');
            td.style.backgroundColor = this._heatColor(n, range.min, range.max);
          }
        }
        tr.appendChild(td);
      }
      // PRESERVED: row click -> global event for the detail drawer module.
      const open = () => {
        document.dispatchEvent(new CustomEvent('screener:rowclick', { detail: row }));
      };
      tr.tabIndex = 0;
      tr.setAttribute('role', 'row');
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => {
        if (e.target !== tr) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
      tbody.appendChild(tr);
    });
    return tbody;
  }

  // ---- Summary-stat footer: per numeric visible column, over visible rows. ----
  _renderFooter(rows, columns) {
    const host = document.getElementById('summary-footer');
    if (!host) return;
    host.innerHTML = '';

    const numericCols = columns.filter((c) => this.isNumeric(c));
    if (!rows.length || !numericCols.length) return; // :empty hides it

    // Stats per numeric column.
    const statsByCol = {};
    for (const colId of numericCols) {
      const nums = [];
      for (const row of rows) {
        const n = toNumber(row[colId]);
        if (n != null) nums.push(n);
      }
      statsByCol[colId] = computeStats(nums);
    }

    const wrap = document.createElement('div');
    wrap.className = 'summary-wrap';

    // Selector: choose all rows or a single stat row.
    const head = document.createElement('div');
    head.className = 'summary-head';
    const open = loadStatsOpen();
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'summary-eyebrow summary-toggle';
    label.setAttribute('aria-expanded', String(open));
    label.textContent = (open ? '\u25BE' : '\u25B8') + ' COLUMN STATS \u00B7 visible rows';
    label.addEventListener('click', () => {
      saveStatsOpen(!open);
      this._renderFooter(rows, columns);
    });
    head.appendChild(label);
    if (!open) {
      wrap.appendChild(head);
      host.appendChild(wrap);
      return;
    }

    const sel = document.createElement('select');
    sel.className = 'summary-select';
    const optAll = document.createElement('option');
    optAll.value = 'all';
    optAll.textContent = 'All stats';
    sel.appendChild(optAll);
    for (const s of STAT_ROWS) {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = STAT_LABELS[s];
      sel.appendChild(o);
    }
    sel.value = this.statMode;
    sel.addEventListener('change', () => {
      this.statMode = sel.value;
      this._renderFooter(rows, columns);
    });
    head.appendChild(sel);
    wrap.appendChild(head);

    // The stat grid: a mono table aligned to the numeric columns.
    const table = document.createElement('table');
    table.className = 'summary-table';

    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'summary-stat-name';
    corner.textContent = 'STAT';
    htr.appendChild(corner);
    for (const colId of numericCols) {
      const th = document.createElement('th');
      th.className = 'num';
      th.textContent = labelFor(colId, this.fieldsIndex);
      th.title = colId;
      htr.appendChild(th);
    }
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const statsToShow = this.statMode === 'all' ? STAT_ROWS : [this.statMode];
    for (const stat of statsToShow) {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.className = 'summary-stat-name';
      name.textContent = STAT_LABELS[stat];
      tr.appendChild(name);
      for (const colId of numericCols) {
        const td = document.createElement('td');
        td.className = 'num';
        const v = statsByCol[colId][stat];
        if (v == null) {
          td.classList.add('is-null');
          td.textContent = '·';
        } else if (stat === 'count') {
          td.textContent = String(v);
        } else {
          td.textContent = formatValue(v, this.fieldsIndex[colId]);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    host.appendChild(wrap);
  }
}

export default { renderTable, TableView };
