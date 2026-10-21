// filters.js - the visual FILTER BUILDER module.
//
// Mounts in #filter-panel. Builds a dense synthwave filter builder: searchable
// field picker, type-adaptive operator dropdown, operator-adaptive value area,
// AND/OR match toggle, and an APPLY button that writes store.filters + match
// then re-runs the screen.
//
// Backend op contract (backend/screener.py is the source of truth):
//   scalar value:  > >= < <= == != above_pct below_pct like not_like
//                  crosses crosses_above crosses_below
//   2-tuple [a,b]: between not_between in_week_range in_month_range
//   list value:    isin not_in
//   no value:      empty not_empty
//
// No em dashes anywhere.

import { pickDefaultField } from './defaults.js';

(function () {
  'use strict';

  // ---- Operator catalogs by field type ------------------------------------
  // Each op: { op, label, value } where value is the value-input family:
  //   'single'  one input
  //   'dual'    two inputs -> emits [a, b]
  //   'list'    comma-separated input -> emits array
  //   'field'   another field picker -> emits a field id string
  //   'none'    no input -> value omitted
  const OP = {
    gt:        { op: '>',              label: '>  greater than',   value: 'single' },
    gte:       { op: '>=',             label: '>= at least',       value: 'single' },
    lt:        { op: '<',              label: '<  less than',      value: 'single' },
    lte:       { op: '<=',             label: '<= at most',        value: 'single' },
    eq:        { op: '==',             label: '== equals',         value: 'single' },
    neq:       { op: '!=',             label: '!= not equals',     value: 'single' },
    between:   { op: 'between',        label: 'between',           value: 'dual' },
    notBetween:{ op: 'not_between',    label: 'not between',       value: 'dual' },
    abovePct:  { op: 'above_pct',      label: 'above by %',        value: 'single' },
    belowPct:  { op: 'below_pct',      label: 'below by %',        value: 'single' },
    crosses:   { op: 'crosses',        label: 'crosses field',     value: 'field' },
    crossesAb: { op: 'crosses_above',  label: 'crosses above',     value: 'field' },
    crossesBe: { op: 'crosses_below',  label: 'crosses below',     value: 'field' },
    inWeek:    { op: 'in_week_range',  label: 'in 52W range',      value: 'dual' },
    inMonth:   { op: 'in_month_range', label: 'in month range',    value: 'dual' },
    like:      { op: 'like',           label: 'contains (like)',   value: 'single' },
    notLike:   { op: 'not_like',       label: 'not contains',      value: 'single' },
    isin:      { op: 'isin',           label: 'is one of',         value: 'list' },
    notIn:     { op: 'not_in',         label: 'is not one of',     value: 'list' },
    empty:     { op: 'empty',          label: 'is empty',          value: 'none' },
    notEmpty:  { op: 'not_empty',      label: 'is not empty',      value: 'none' },
  };

  const NUMERIC_OPS = [
    OP.gt, OP.gte, OP.lt, OP.lte, OP.eq, OP.neq,
    OP.between, OP.notBetween, OP.abovePct, OP.belowPct,
    OP.crosses, OP.crossesAb, OP.crossesBe,
    OP.inWeek, OP.inMonth, OP.empty, OP.notEmpty,
  ];

  const STRING_OPS = [
    OP.like, OP.notLike, OP.isin, OP.notIn,
    OP.eq, OP.neq, OP.empty, OP.notEmpty,
  ];

  const NUMERIC_TYPES = new Set(['num', 'pct', 'price', 'int', 'bignum']);

  // Map an op string back to its catalog meta (for value-area rendering).
  const OP_BY_STRING = {};
  for (const key in OP) OP_BY_STRING[OP[key].op] = OP[key];

  function isNumericType(type) {
    return NUMERIC_TYPES.has(type);
  }

  function opsForField(meta) {
    if (!meta) return NUMERIC_OPS;
    return isNumericType(meta.type) ? NUMERIC_OPS : STRING_OPS;
  }

  // ---- Small DOM helpers ---------------------------------------------------
  function h(tag, cls, attrs) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (attrs) {
      for (const k in attrs) {
        if (k === 'text') node.textContent = attrs[k];
        else node.setAttribute(k, attrs[k]);
      }
    }
    return node;
  }

  // ---- Styles --------------------------------------------------------------
  function injectStyles() {
    if (document.getElementById('filters-styles')) return;
    const style = h('style');
    style.id = 'filters-styles';
    style.textContent = `
.flt-wrap { display: flex; flex-direction: column; gap: var(--sp-2); }
.flt-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--sp-2); padding-bottom: var(--sp-1);
}
.flt-title {
  display: flex; align-items: center; gap: var(--sp-2);
  font-size: 12px; font-weight: 700; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--text);
}
.flt-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 999px;
  font-family: var(--font-mono); font-size: 12px; font-weight: 700;
  color: var(--cyan);
  border: 1px solid rgba(0, 240, 255, 0.45);
  background: rgba(0, 240, 255, 0.08);
  box-shadow: var(--glow-cyan);
}
.flt-count.flt-zero { color: var(--muted); border-color: var(--line); background: transparent; box-shadow: none; }
.flt-clear {
  font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted); background: transparent; border: none; cursor: pointer;
  padding: 2px 4px; transition: color 0.15s ease;
}
.flt-clear:hover { color: var(--pink); }

.flt-rows { display: flex; flex-direction: column; gap: var(--sp-2); }

.flt-row {
  position: relative;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--sp-1);
  padding: var(--sp-2);
  background: var(--glass);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-sm);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.flt-row:focus-within { border-color: rgba(0, 240, 255, 0.5); box-shadow: var(--glow-cyan); }

.flt-row-main { display: flex; flex-direction: column; gap: var(--sp-1); min-width: 0; }
.flt-row-x {
  align-self: start;
  width: 22px; height: 22px; line-height: 1;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--muted); background: transparent;
  border: 1px solid var(--line); cursor: pointer; font-size: 13px;
  transition: color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}
.flt-row-x:hover { color: var(--pink); border-color: rgba(255, 0, 60, 0.5); box-shadow: var(--glow-pink); }

.flt-field, .flt-op, .flt-val, .flt-val-field {
  width: 100%;
  padding: 5px 8px;
  background: rgba(10, 10, 14, 0.8);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  color: var(--text);
  outline: none;
  font-size: 12px;
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
}
.flt-field, .flt-op, .flt-val-field { font-family: var(--font-ui); cursor: pointer; }
.flt-val { font-family: var(--font-mono); }
.flt-field:hover, .flt-op:hover, .flt-val:hover, .flt-val-field:hover { border-color: rgba(0, 240, 255, 0.4); }
.flt-field:focus, .flt-op:focus, .flt-val:focus, .flt-val-field:focus {
  border-color: var(--cyan); box-shadow: var(--glow-cyan);
}

.flt-val-row { display: flex; gap: var(--sp-1); }
.flt-val-row .flt-val { flex: 1 1 0; min-width: 0; }
.flt-val-sep { align-self: center; color: var(--muted); font-size: 12px; font-family: var(--font-mono); }

.flt-actions { display: flex; align-items: center; gap: var(--sp-2); padding-top: var(--sp-1); }
.flt-add {
  flex: 1 1 auto;
  font-size: 12px; letter-spacing: 0.06em;
  padding: 6px 10px;
  color: var(--cyan);
  background: rgba(0, 240, 255, 0.05);
  border: 1px dashed rgba(0, 240, 255, 0.35);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}
.flt-add:hover { border-color: var(--cyan); box-shadow: var(--glow-cyan); background: rgba(0, 240, 255, 0.1); }

.flt-match {
  display: inline-flex; align-items: center;
  border: 1px solid var(--line); border-radius: 999px; overflow: hidden;
  background: rgba(10, 10, 14, 0.8);
}
.flt-seg {
  padding: 4px 12px;
  font-size: 12px; font-weight: 700; letter-spacing: 0.08em;
  font-family: var(--font-mono);
  color: var(--muted); background: transparent; border: none; cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}
.flt-seg.flt-on-all { color: var(--cyan); background: rgba(0, 240, 255, 0.12); box-shadow: inset 0 0 10px rgba(0, 240, 255, 0.25); }
.flt-seg.flt-on-any { color: var(--purple); background: rgba(176, 38, 255, 0.12); box-shadow: inset 0 0 10px rgba(176, 38, 255, 0.25); }

.flt-apply {
  width: 100%;
  padding: 8px 12px;
  font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--green);
  background: rgba(0, 255, 136, 0.08);
  border: 1px solid rgba(0, 255, 136, 0.4);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: box-shadow 0.15s ease, border-color 0.15s ease, background 0.15s ease, transform 0.05s ease;
}
.flt-apply:hover { border-color: var(--green); box-shadow: var(--glow-green); background: rgba(0, 255, 136, 0.16); }
.flt-apply:active { transform: translateY(1px); }

.flt-empty {
  padding: var(--sp-3);
  text-align: center;
  font-size: 12px; color: var(--muted);
  border: 1px dashed var(--line); border-radius: var(--radius-sm);
}
`;
    document.head.appendChild(style);
  }

  // ---- Module init ---------------------------------------------------------
  function init(ctx) {
    const panel = ctx.el('filter-panel');
    if (!panel) {
      console.warn('filters: #filter-panel not found, skipping init');
      return;
    }
    const store = ctx.store;
    injectStyles();

    // Build grouped field option lists once. fields = [{id,label,group,type}].
    const fields = store.state.fields || [];
    const fieldByGroup = {};
    for (const f of fields) {
      (fieldByGroup[f.group] = fieldByGroup[f.group] || []).push(f);
    }
    const fieldIndex = store.state.fieldIndex || {};

    // Local editing model. Each row: { field, op, v1, v2, list, vfield }.
    // We seed from store.state.filters so presets are reflected.
    let rows = filtersToRows(store.state.filters || []);
    if (rows.length === 0) rows = [blankRow()];

    // Track the last filters JSON we APPLIED so a store change that simply
    // echoes our own apply does not trigger a needless rebuild.
    let lastFiltersJson = JSON.stringify(store.state.filters || []);

    // Mount scaffold.
    panel.classList.remove('slot-placeholder');
    panel.innerHTML = '';
    const wrap = h('div', 'flt-wrap');
    panel.appendChild(wrap);

    function blankRow() {
      const numeric = fields.filter((f) => isNumericType(f.type));
      const used = typeof rows !== 'undefined' && Array.isArray(rows) ? rows.map((r) => r.field) : [];
      const fid = pickDefaultField(numeric.length ? numeric : fields, used);
      const meta = fieldIndex[fid];
      const ops = opsForField(meta);
      return { field: fid, op: ops[0] ? ops[0].op : '>', v1: '', v2: '', list: '', vfield: defaultCrossField(fid) };
    }

    function defaultCrossField(excludeId) {
      const f = fields.find((x) => isNumericType(x.type) && x.id !== excludeId);
      return f ? f.id : (fields[0] ? fields[0].id : '');
    }

    // Convert a store filters array into editable rows.
    function filtersToRows(filters) {
      const out = [];
      for (const flt of filters) {
        if (!flt || !flt.field) continue;
        const opMeta = OP_BY_STRING[flt.op];
        const row = { field: flt.field, op: flt.op, v1: '', v2: '', list: '', vfield: '' };
        if (!opMeta) { out.push(row); continue; }
        if (opMeta.value === 'dual' && Array.isArray(flt.value)) {
          row.v1 = flt.value[0] != null ? String(flt.value[0]) : '';
          row.v2 = flt.value[1] != null ? String(flt.value[1]) : '';
        } else if (opMeta.value === 'list' && Array.isArray(flt.value)) {
          row.list = flt.value.join(', ');
        } else if (opMeta.value === 'field') {
          row.vfield = flt.value != null ? String(flt.value) : '';
        } else if (opMeta.value === 'single') {
          row.v1 = flt.value != null ? String(flt.value) : '';
        }
        out.push(row);
      }
      return out;
    }

    // ---- Rendering ---------------------------------------------------------
    function buildFieldSelect(selectedId, onChange) {
      const sel = h('select', 'flt-field glow-hover');
      // Sort groups in catalog order by first appearance.
      const seen = [];
      for (const f of fields) if (!seen.includes(f.group)) seen.push(f.group);
      for (const g of seen) {
        const og = h('optgroup');
        og.label = g;
        for (const f of fieldByGroup[g]) {
          const o = h('option');
          o.value = f.id;
          o.textContent = f.label;
          if (f.id === selectedId) o.selected = true;
          og.appendChild(o);
        }
        sel.appendChild(og);
      }
      sel.addEventListener('change', () => onChange(sel.value));
      return sel;
    }

    function buildOpSelect(meta, selectedOp, onChange) {
      const sel = h('select', 'flt-op glow-hover');
      const ops = opsForField(meta);
      let matched = false;
      for (const o of ops) {
        const opt = h('option');
        opt.value = o.op;
        opt.textContent = o.label;
        if (o.op === selectedOp) { opt.selected = true; matched = true; }
        sel.appendChild(opt);
      }
      // If the previously selected op is not valid for this field type, fall
      // back to the first available op.
      if (!matched && ops[0]) sel.value = ops[0].op;
      sel.addEventListener('change', () => onChange(sel.value));
      return sel;
    }

    function buildValueArea(row, meta) {
      const opMeta = OP_BY_STRING[row.op];
      const fam = opMeta ? opMeta.value : 'single';
      const numeric = isNumericType(meta ? meta.type : 'num');

      if (fam === 'none') return null;

      if (fam === 'dual') {
        const wrapV = h('div', 'flt-val-row');
        const a = h('input', 'flt-val');
        a.type = numeric ? 'number' : 'text';
        a.placeholder = 'min';
        a.value = row.v1;
        a.addEventListener('input', () => { row.v1 = a.value; });
        const sep = h('span', 'flt-val-sep', { text: 'to' });
        const b = h('input', 'flt-val');
        b.type = numeric ? 'number' : 'text';
        b.placeholder = 'max';
        b.value = row.v2;
        b.addEventListener('input', () => { row.v2 = b.value; });
        wrapV.appendChild(a); wrapV.appendChild(sep); wrapV.appendChild(b);
        return wrapV;
      }

      if (fam === 'list') {
        const inp = h('input', 'flt-val');
        inp.type = 'text';
        inp.placeholder = numeric ? 'e.g. 1, 2, 3' : 'e.g. AAPL, MSFT';
        inp.value = row.list;
        inp.addEventListener('input', () => { row.list = inp.value; });
        return inp;
      }

      if (fam === 'field') {
        const sel = buildFieldSelect(row.vfield, (v) => { row.vfield = v; });
        sel.classList.remove('flt-field');
        sel.classList.add('flt-val-field');
        return sel;
      }

      // single
      const inp = h('input', 'flt-val');
      inp.type = numeric ? 'number' : 'text';
      inp.placeholder = numeric ? 'value' : 'text';
      inp.value = row.v1;
      inp.addEventListener('input', () => { row.v1 = inp.value; });
      return inp;
    }

    function renderRow(row, index) {
      const meta = fieldIndex[row.field];
      const rowEl = h('div', 'flt-row');
      const main = h('div', 'flt-row-main');

      const fieldSel = buildFieldSelect(row.field, (v) => {
        row.field = v;
        // Reset op if it no longer applies to the new field type.
        const newMeta = fieldIndex[v];
        const ops = opsForField(newMeta);
        if (!ops.some((o) => o.op === row.op)) row.op = ops[0] ? ops[0].op : row.op;
        if (!row.vfield) row.vfield = defaultCrossField(v);
        renderAll();
      });
      main.appendChild(fieldSel);

      const opSel = buildOpSelect(meta, row.op, (v) => {
        row.op = v;
        renderAll();
      });
      main.appendChild(opSel);

      const valArea = buildValueArea(row, meta);
      if (valArea) main.appendChild(valArea);

      rowEl.appendChild(main);

      const x = h('button', 'flt-row-x', { text: '×', title: 'Remove filter', type: 'button' });
      x.addEventListener('click', () => {
        rows.splice(index, 1);
        if (rows.length === 0) rows.push(blankRow());
        renderAll();
      });
      rowEl.appendChild(x);
      return rowEl;
    }

    let countBadge = null;
    let matchAllBtn = null;
    let matchAnyBtn = null;
    let rowsHost = null;

    function activeCount() {
      let n = 0;
      for (const r of rows) if (rowToFilter(r) != null) n++;
      return n;
    }

    function refreshChrome() {
      const n = activeCount();
      if (countBadge) {
        countBadge.textContent = String(n);
        countBadge.classList.toggle('flt-zero', n === 0);
      }
      const match = store.state.match === 'any' ? 'any' : 'all';
      if (matchAllBtn && matchAnyBtn) {
        matchAllBtn.classList.toggle('flt-on-all', match === 'all');
        matchAnyBtn.classList.toggle('flt-on-any', match === 'any');
      }
    }

    function renderRows() {
      if (!rowsHost) return;
      rowsHost.innerHTML = '';
      rows.forEach((r, i) => rowsHost.appendChild(renderRow(r, i)));
      refreshChrome();
    }

    function renderAll() {
      wrap.innerHTML = '';

      // Header
      const head = h('div', 'flt-head');
      const title = h('div', 'flt-title');
      const tlabel = h('span', null, { text: 'Filters' });
      countBadge = h('span', 'flt-count');
      title.appendChild(tlabel);
      title.appendChild(countBadge);
      head.appendChild(title);
      const clear = h('button', 'flt-clear', { text: 'Clear', type: 'button' });
      clear.addEventListener('click', () => {
        rows = [blankRow()];
        renderAll();
      });
      head.appendChild(clear);
      wrap.appendChild(head);

      // Rows host
      rowsHost = h('div', 'flt-rows');
      wrap.appendChild(rowsHost);
      renderRows();

      // Actions: + add filter and match toggle
      const actions = h('div', 'flt-actions');
      const add = h('button', 'flt-add', { text: '+ Add filter', type: 'button' });
      add.addEventListener('click', () => {
        rows.push(blankRow());
        renderAll();
      });
      actions.appendChild(add);

      const match = h('div', 'flt-match');
      matchAllBtn = h('button', 'flt-seg', { text: 'ALL', title: 'Match all (AND)', type: 'button' });
      matchAnyBtn = h('button', 'flt-seg', { text: 'ANY', title: 'Match any (OR)', type: 'button' });
      matchAllBtn.addEventListener('click', () => { store.set({ match: 'all' }); refreshChrome(); });
      matchAnyBtn.addEventListener('click', () => { store.set({ match: 'any' }); refreshChrome(); });
      match.appendChild(matchAllBtn);
      match.appendChild(matchAnyBtn);
      actions.appendChild(match);
      wrap.appendChild(actions);

      // Apply
      const apply = h('button', 'flt-apply', { text: 'Apply', type: 'button' });
      apply.addEventListener('click', onApply);
      wrap.appendChild(apply);

      refreshChrome();
    }

    // ---- Build a backend filter object from a row, or null if incomplete --
    function rowToFilter(row) {
      const field = row.field;
      if (!field) return null;
      const meta = fieldIndex[field];
      const numeric = isNumericType(meta ? meta.type : 'num');
      const opMeta = OP_BY_STRING[row.op];
      if (!opMeta) return null;
      const fam = opMeta.value;

      if (fam === 'none') {
        return { field, op: row.op };
      }

      if (fam === 'dual') {
        if (row.v1 === '' || row.v1 == null || row.v2 === '' || row.v2 == null) return null;
        const a = numeric ? Number(row.v1) : row.v1;
        const b = numeric ? Number(row.v2) : row.v2;
        if (numeric && (Number.isNaN(a) || Number.isNaN(b))) return null;
        return { field, op: row.op, value: [a, b] };
      }

      if (fam === 'list') {
        const parts = String(row.list || '')
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        if (parts.length === 0) return null;
        const value = numeric
          ? parts.map((s) => Number(s)).filter((n) => !Number.isNaN(n))
          : parts;
        if (value.length === 0) return null;
        return { field, op: row.op, value };
      }

      if (fam === 'field') {
        if (!row.vfield) return null;
        return { field, op: row.op, value: row.vfield };
      }

      // single
      if (row.v1 === '' || row.v1 == null) return null;
      const v = numeric ? Number(row.v1) : row.v1;
      if (numeric && Number.isNaN(v)) return null;
      return { field, op: row.op, value: v };
    }

    function buildFilters() {
      const out = [];
      for (const r of rows) {
        const f = rowToFilter(r);
        if (f != null) out.push(f);
      }
      return out;
    }

    function onApply() {
      const filters = buildFilters();
      const match = store.state.match === 'any' ? 'any' : 'all';
      lastFiltersJson = JSON.stringify(filters);
      store.set({ filters, match });
      store.runScreen();
    }

    // ---- React to external filter replacement (presets, etc.) -------------
    store.subscribe(() => {
      const current = store.state.filters || [];
      const json = JSON.stringify(current);
      if (json === lastFiltersJson) {
        // Same filters identity we last saw. Just keep chrome (badge, match
        // toggle) in sync without rebuilding rows.
        refreshChrome();
        return;
      }
      lastFiltersJson = json;
      rows = filtersToRows(current);
      if (rows.length === 0) rows = [blankRow()];
      renderAll();
    });

    renderAll();
  }

  // ---- Register ------------------------------------------------------------
  function register() {
    if (window.Screener && typeof window.Screener.registerModule === 'function') {
      window.Screener.registerModule('filters', init);
    } else {
      // Bootstrap has not built the namespace yet. Retry on next tick.
      setTimeout(register, 0);
    }
  }
  register();
})();
