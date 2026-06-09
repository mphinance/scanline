// columns.js - the COLUMN PICKER + computed/stat column builder.
//
// Mounts in #column-panel. Manages three request arrays on the store:
//   store.state.columns  ordered field ids (these get .select()'ed server-side)
//   store.state.computed [{id, expr}]  user formula columns
//   store.state.stats    [{fn, field}] in-result statistic columns
//
// The backend appends computed cols, then stat cols, then factor_score to the
// result columns on its own. We only manage the REQUEST arrays here, then call
// store.runScreen() so the new columns show up in the table.
//
// Stat column naming matches analytics.py exactly: f"{fn}({field})", so a stat
// {fn:'zscore', field:'change'} yields a result key "zscore(change)". Our chip
// label uses that same string so it reads identically to the table header.
//
// Allowed computed funcs/operators mirror backend/analytics.py:
//   funcs: abs min max log ln sqrt round floor ceil
//   ops:   + - * / % ** //
//
// No em dashes anywhere (code or UI copy).

const STAT_FNS = ['zscore', 'pctrank', 'rank', 'norm'];
const ALLOWED_FUNCS = ['abs', 'min', 'max', 'log', 'ln', 'sqrt', 'round', 'floor', 'ceil'];
const ALLOWED_OPS = '+ - * / % ** //';

// Numeric field types from fields.py that make sense for stat/computed math.
const NUMERIC_TYPES = new Set(['num', 'pct', 'price', 'int', 'bignum']);

const STYLE = `
.col-root { display: flex; flex-direction: column; gap: var(--sp-3); padding: var(--sp-3); }
.col-head { display: flex; align-items: center; justify-content: space-between; }
.col-title { font-family: var(--font-mono); font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text); }
.col-section-title { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); font-weight: 600; margin-bottom: var(--sp-1); }
.col-section { display: flex; flex-direction: column; gap: var(--sp-2); }

/* Selected list */
.col-selected { display: flex; flex-direction: column; gap: 3px; max-height: 220px; overflow-y: auto; }
.col-chip-row {
  display: flex; align-items: center; gap: var(--sp-2);
  padding: 4px 6px; border-radius: var(--radius-sm);
  background: var(--glass); border: 1px solid var(--border-glass);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.col-chip-row:hover { border-color: rgba(0, 240, 255, 0.4); }
.col-chip-row.col-locked { opacity: 0.7; }
.col-chip-row[draggable="true"] { cursor: grab; }
.col-chip-row.col-dragging { opacity: 0.4; cursor: grabbing; border-color: var(--cyan); }
.col-chip-row.col-drop-before { box-shadow: inset 0 2px 0 0 var(--cyan), var(--glow-cyan); }
.col-chip-row.col-drop-after { box-shadow: inset 0 -2px 0 0 var(--cyan), var(--glow-cyan); }
.col-chip-grip { font-family: var(--font-mono); font-size: 11px; color: var(--muted); flex: 0 0 auto; cursor: grab; user-select: none; }
.col-chip-id { font-family: var(--font-mono); font-size: 11px; color: var(--cyan); flex: 0 0 auto; }
.col-chip-label { font-size: 11px; color: var(--muted); flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-iconbtn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; padding: 0; cursor: pointer;
  background: transparent; border: 1px solid var(--line); border-radius: var(--radius-sm);
  color: var(--muted); font-family: var(--font-mono); font-size: 11px; line-height: 1;
  transition: color 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
}
.col-iconbtn:hover { color: var(--cyan); border-color: rgba(0, 240, 255, 0.5); box-shadow: var(--glow-cyan); }
.col-iconbtn:disabled { opacity: 0.3; cursor: not-allowed; box-shadow: none; }
.col-iconbtn.col-x:hover { color: var(--pink); border-color: rgba(255, 0, 60, 0.5); box-shadow: var(--glow-pink); }

/* Add catalog */
.col-search { width: 100%; }
.col-catalog { display: flex; flex-direction: column; gap: 2px; max-height: 260px; overflow-y: auto; padding-right: 2px; }
.col-group-name { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--purple); margin-top: var(--sp-2); padding: 2px 0; position: sticky; top: 0; background: var(--panel); }
.col-opt {
  display: flex; align-items: center; gap: var(--sp-2);
  padding: 3px 6px; border-radius: var(--radius-sm); cursor: pointer;
  border: 1px solid transparent; transition: background 0.12s ease, border-color 0.12s ease;
}
.col-opt:hover { background: rgba(0, 240, 255, 0.05); border-color: rgba(0, 240, 255, 0.25); }
.col-opt.col-on { background: rgba(0, 255, 136, 0.06); border-color: rgba(0, 255, 136, 0.3); }
.col-opt-mark { font-family: var(--font-mono); font-size: 11px; width: 12px; text-align: center; color: var(--muted); }
.col-opt.col-on .col-opt-mark { color: var(--green); }
.col-opt-id { font-family: var(--font-mono); font-size: 11px; color: var(--cyan); }
.col-opt-label { font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; }

/* Computed + stat builders */
.col-form { display: flex; flex-direction: column; gap: var(--sp-2); }
.col-form-row { display: flex; gap: var(--sp-2); }
.col-input { font-family: var(--font-mono); font-size: 11px; }
.col-input-id { flex: 0 0 34%; }
.col-input-expr { flex: 1 1 auto; }
.col-add-btn { padding: 4px 10px; font-size: 11px; flex: 0 0 auto; }
.col-hint { font-family: var(--font-mono); font-size: 9.5px; line-height: 1.5; color: var(--muted); }
.col-hint b { color: var(--green); font-weight: 600; }

.col-tags { display: flex; flex-wrap: wrap; gap: var(--sp-1); }
.col-tag {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 6px 3px 8px; border-radius: 999px;
  font-family: var(--font-mono); font-size: 10px; font-weight: 600;
  border: 1px solid rgba(176, 38, 255, 0.4); color: var(--purple); background: rgba(176, 38, 255, 0.07);
}
.col-tag.col-tag-stat { border-color: rgba(0, 240, 255, 0.4); color: var(--cyan); background: rgba(0, 240, 255, 0.07); }
.col-tag .col-tag-x { cursor: pointer; color: var(--muted); }
.col-tag .col-tag-x:hover { color: var(--pink); }

.col-apply { width: 100%; justify-content: center; margin-top: var(--sp-1); }
.col-empty { font-size: 10.5px; color: var(--muted); font-style: italic; }
.col-more { font-size: 10px; color: var(--muted); padding: 6px 4px 2px; border-top: 1px dashed var(--line); margin-top: 4px; }
.tbl-cols-btn {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-mono); font-size: 11px; font-weight: 600;
  letter-spacing: 0.04em; text-transform: uppercase;
  padding: 5px 10px; cursor: pointer;
  color: var(--cyan); background: rgba(0, 240, 255, 0.08);
  border: 1px solid rgba(0, 240, 255, 0.4); border-radius: var(--radius-sm);
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
.tbl-cols-btn:hover { background: rgba(0, 240, 255, 0.16); box-shadow: var(--glow-cyan); }
`;

function injectStyles() {
  if (document.getElementById('columns-styles')) return;
  const tag = document.createElement('style');
  tag.id = 'columns-styles';
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

// Slug guard for computed ids: non-empty, no whitespace.
function isValidId(id) {
  return typeof id === 'string' && id.length > 0 && !/\s/.test(id);
}

window.Screener.registerModule('columns', (ctx) => {
  const { store } = ctx;
  injectStyles();

  const mount = ctx.el('column-panel');
  if (!mount) return;
  mount.classList.remove('slot-placeholder');
  mount.textContent = '';

  // Build the static shell once. Render functions repopulate the dynamic bits.
  const root = document.createElement('div');
  root.className = 'col-root';
  root.innerHTML = `
    <div class="col-head">
      <span class="col-title">Columns</span>
      <span class="badge badge-cyan" data-ref="count">0</span>
    </div>

    <div class="col-section">
      <div class="col-section-title">Selected</div>
      <div class="col-selected" data-ref="selected"></div>
    </div>

    <div class="col-section">
      <div class="col-section-title">Add fields</div>
      <input class="input col-search" data-ref="search" type="text"
             placeholder="Search label, id, or group" />
      <div class="col-catalog" data-ref="catalog"></div>
    </div>

    <div class="col-section">
      <div class="col-section-title">Computed columns</div>
      <div class="col-form">
        <div class="col-form-row">
          <input class="input col-input col-input-id" data-ref="cId" type="text" placeholder="id (slug)" />
          <input class="input col-input col-input-expr" data-ref="cExpr" type="text" placeholder="(high-low)/close*100" />
        </div>
        <div class="col-form-row">
          <button class="btn col-add-btn" data-ref="cAdd">Add formula</button>
        </div>
        <div class="col-tags" data-ref="computedTags"></div>
        <div class="col-hint">
          funcs <b>${ALLOWED_FUNCS.join(' ')}</b> · ops <b>${ALLOWED_OPS}</b>
        </div>
      </div>
    </div>

    <div class="col-section">
      <div class="col-section-title">Stat columns</div>
      <div class="col-form">
        <div class="col-form-row">
          <select class="select col-input" data-ref="sFn">
            ${STAT_FNS.map((f) => `<option value="${f}">${f}</option>`).join('')}
          </select>
          <select class="select col-input grow" data-ref="sField"></select>
          <button class="btn col-add-btn" data-ref="sAdd">Add</button>
        </div>
        <div class="col-tags" data-ref="statTags"></div>
      </div>
    </div>

    <button class="btn btn-primary col-apply glow-hover" data-ref="apply">Apply columns</button>
  `;
  mount.appendChild(root);

  const ref = (name) => root.querySelector(`[data-ref="${name}"]`);
  const els = {
    count: ref('count'),
    selected: ref('selected'),
    search: ref('search'),
    catalog: ref('catalog'),
    cId: ref('cId'),
    cExpr: ref('cExpr'),
    cAdd: ref('cAdd'),
    computedTags: ref('computedTags'),
    sFn: ref('sFn'),
    sField: ref('sField'),
    sAdd: ref('sAdd'),
    statTags: ref('statTags'),
    apply: ref('apply'),
  };

  // ---- Store mutation helpers. Each produces an explicit patch via store.set.

  function setColumns(cols) {
    // Never let the selected set go fully empty: keep at least name.
    let next = cols.slice();
    if (next.length === 0) next = ['name'];
    store.set({ columns: next });
  }

  function addColumn(id) {
    if (store.state.columns.includes(id)) return;
    setColumns([...store.state.columns, id]);
  }

  function removeColumn(id) {
    setColumns(store.state.columns.filter((c) => c !== id));
    store.runScreen(); // auto-apply on remove
  }

  function moveColumn(id, delta) {
    const cols = store.state.columns.slice();
    const i = cols.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= cols.length) return;
    [cols[i], cols[j]] = [cols[j], cols[i]];
    setColumns(cols);
  }

  // Reorder by drag-and-drop: move draggedId so it lands just before targetId
  // (or to the very end when targetId is null). Reorders only, never removes,
  // so 'name' (or any column) is preserved. Reruns the screen on a real change.
  function reorderColumn(draggedId, targetId, after) {
    const cols = store.state.columns.slice();
    const from = cols.indexOf(draggedId);
    if (from < 0 || draggedId === targetId) return;
    cols.splice(from, 1);
    let insertAt;
    if (targetId == null) {
      insertAt = cols.length;
    } else {
      const t = cols.indexOf(targetId);
      if (t < 0) return;
      insertAt = after ? t + 1 : t;
    }
    cols.splice(insertAt, 0, draggedId);
    // No-op guard: identical order means no rerun.
    if (cols.join('') === store.state.columns.join('')) return;
    setColumns(cols);
    store.runScreen();
  }

  // Detect bare field ids referenced by a computed expression and auto-add any
  // that are not already selected, so the backend has the raw value to compute
  // on. We only add ids that EXACTLY match a known catalog field, so a token
  // like "close" adds close but a function name like "sqrt" or a literal never
  // matches a field id and is left alone. Field ids that are not plain
  // identifiers (e.g. "Perf.W", "MACD.macd") cannot appear as bare AST names in
  // the backend evaluator anyway, so matching identifier-like tokens is correct.
  function autoAddExprFields(expr) {
    const known = store.state.fieldIndex || {};
    const tokens = expr.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
    const seen = new Set();
    const toAdd = [];
    for (const tok of tokens) {
      if (seen.has(tok)) continue;
      seen.add(tok);
      if (ALLOWED_FUNCS.includes(tok)) continue;
      if (!known[tok]) continue;
      if (store.state.columns.includes(tok)) continue;
      toAdd.push(tok);
    }
    if (toAdd.length) setColumns([...store.state.columns, ...toAdd]);
  }

  function addComputed() {
    const id = (els.cId.value || '').trim();
    const expr = (els.cExpr.value || '').trim();
    if (!isValidId(id)) {
      window.Screener.toast('Computed id must be a non-empty slug with no spaces.', { title: 'Bad id', kind: 'err' });
      return;
    }
    if (!expr) {
      window.Screener.toast('Computed expression is empty.', { title: 'Bad expression', kind: 'err' });
      return;
    }
    if (store.state.computed.some((c) => c.id === id)) {
      window.Screener.toast(`Computed column "${id}" already exists.`, { title: 'Duplicate', kind: 'err' });
      return;
    }
    autoAddExprFields(expr);
    store.set({ computed: [...store.state.computed, { id, expr }] });
    els.cId.value = '';
    els.cExpr.value = '';
  }

  function removeComputed(id) {
    store.set({ computed: store.state.computed.filter((c) => c.id !== id) });
    store.runScreen();
  }

  function addStat() {
    const fn = els.sFn.value;
    const field = els.sField.value;
    if (!STAT_FNS.includes(fn) || !field) return;
    if (store.state.stats.some((s) => s.fn === fn && s.field === field)) {
      window.Screener.toast(`${fn}(${field}) already added.`, { title: 'Duplicate', kind: 'err' });
      return;
    }
    // Stat math needs the raw field present in the result rows.
    addColumn(field);
    store.set({ stats: [...store.state.stats, { fn, field }] });
  }

  function removeStat(spec) {
    store.set({ stats: store.state.stats.filter((s) => !(s.fn === spec.fn && s.field === spec.field)) });
    store.runScreen();
  }

  // ---- Renderers. Driven by store state; idempotent.

  // Clear any drop indicators across the selected list.
  function clearDropMarks() {
    els.selected.querySelectorAll('.col-drop-before, .col-drop-after').forEach((n) => {
      n.classList.remove('col-drop-before', 'col-drop-after');
    });
  }

  // Is the pointer in the top half of the row (drop before) vs bottom (after)?
  function isBeforeHalf(e, row) {
    const rect = row.getBoundingClientRect();
    return (e.clientY - rect.top) < rect.height / 2;
  }

  function renderSelected() {
    const cols = store.state.columns;
    els.count.textContent = String(cols.length);
    els.selected.textContent = '';
    cols.forEach((id, i) => {
      const meta = store.state.fieldIndex[id];
      const locked = cols.length === 1 && id === 'name';
      const row = document.createElement('div');
      row.className = 'col-chip-row' + (locked ? ' col-locked' : '');
      row.dataset.col = id;

      // Drag-and-drop reorder. A locked single 'name' chip cannot move anywhere
      // useful, so we only enable dragging when there is more than one column.
      if (cols.length > 1) {
        row.draggable = true;
        row.addEventListener('dragstart', (e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', id);
          row.classList.add('col-dragging');
        });
        row.addEventListener('dragend', () => {
          row.classList.remove('col-dragging');
          clearDropMarks();
        });
        row.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const before = isBeforeHalf(e, row);
          clearDropMarks();
          row.classList.add(before ? 'col-drop-before' : 'col-drop-after');
        });
        row.addEventListener('dragleave', () => {
          row.classList.remove('col-drop-before', 'col-drop-after');
        });
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          const draggedId = e.dataTransfer.getData('text/plain');
          const after = !isBeforeHalf(e, row);
          clearDropMarks();
          if (draggedId) reorderColumn(draggedId, id, after);
        });
      }

      const grip = document.createElement('span');
      grip.className = 'col-chip-grip';
      grip.textContent = '⠿';
      grip.title = 'Drag to reorder';
      row.appendChild(grip);

      const idEl = document.createElement('span');
      idEl.className = 'col-chip-id';
      idEl.textContent = id;
      row.appendChild(idEl);

      const labelEl = document.createElement('span');
      labelEl.className = 'col-chip-label';
      labelEl.textContent = meta ? meta.label : '';
      row.appendChild(labelEl);

      const up = document.createElement('button');
      up.className = 'col-iconbtn';
      up.textContent = '↑';
      up.title = 'Move up';
      up.disabled = i === 0;
      up.addEventListener('click', () => moveColumn(id, -1));
      row.appendChild(up);

      const down = document.createElement('button');
      down.className = 'col-iconbtn';
      down.textContent = '↓';
      down.title = 'Move down';
      down.disabled = i === cols.length - 1;
      down.addEventListener('click', () => moveColumn(id, 1));
      row.appendChild(down);

      const x = document.createElement('button');
      x.className = 'col-iconbtn col-x';
      x.textContent = '×';
      x.title = 'Remove';
      x.disabled = locked;
      x.addEventListener('click', () => removeColumn(id));
      row.appendChild(x);

      els.selected.appendChild(row);
    });
  }

  // The catalog can hold over a thousand fields, so cap how many render at once
  // and lean on search. Matches lead with the curated, friendly fields.
  const CATALOG_RENDER_CAP = 200;

  function renderCatalog() {
    const q = (els.search.value || '').trim().toLowerCase();
    const selected = new Set(store.state.columns);
    els.catalog.textContent = '';

    // Collect matches first so we can cap and report how many were hidden.
    const matches = [];
    for (const f of store.state.fields) {
      if (q) {
        const hay = (f.id + ' ' + f.label + ' ' + f.group).toLowerCase();
        if (!hay.includes(q)) continue;
      }
      matches.push(f);
    }

    if (matches.length === 0) {
      const none = document.createElement('div');
      none.className = 'col-empty';
      none.textContent = 'No fields match.';
      els.catalog.appendChild(none);
      return;
    }

    const shown = matches.slice(0, CATALOG_RENDER_CAP);
    const hidden = matches.length - shown.length;

    // Preserve catalog group order by walking the (already ordered) matches.
    const groups = new Map();
    for (const f of shown) {
      if (!groups.has(f.group)) groups.set(f.group, []);
      groups.get(f.group).push(f);
    }

    for (const [group, fields] of groups) {
      const gh = document.createElement('div');
      gh.className = 'col-group-name';
      gh.textContent = group;
      els.catalog.appendChild(gh);

      for (const f of fields) {
        const on = selected.has(f.id);
        const opt = document.createElement('div');
        opt.className = 'col-opt' + (on ? ' col-on' : '');

        const mark = document.createElement('span');
        mark.className = 'col-opt-mark';
        mark.textContent = on ? '✓' : '+';
        opt.appendChild(mark);

        const idEl = document.createElement('span');
        idEl.className = 'col-opt-id';
        idEl.textContent = f.id;
        opt.appendChild(idEl);

        const labelEl = document.createElement('span');
        labelEl.className = 'col-opt-label';
        labelEl.textContent = f.label;
        opt.appendChild(labelEl);

        opt.addEventListener('click', () => {
          if (selected.has(f.id)) removeColumn(f.id);
          else addColumn(f.id);
        });
        els.catalog.appendChild(opt);
      }
    }

    if (hidden > 0) {
      const more = document.createElement('div');
      more.className = 'col-more';
      more.textContent = q
        ? `${hidden} more match. Refine the search to narrow it down.`
        : `${hidden} more fields. Type to search all ${matches.length}.`;
      els.catalog.appendChild(more);
    }
  }

  function renderStatFieldOptions() {
    // Numeric fields only, label like "id  Label".
    const prev = els.sField.value;
    els.sField.textContent = '';
    for (const f of store.state.fields) {
      if (!NUMERIC_TYPES.has(f.type)) continue;
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = `${f.id}  ${f.label}`;
      els.sField.appendChild(opt);
    }
    if (prev) els.sField.value = prev;
  }

  function renderComputedTags() {
    els.computedTags.textContent = '';
    if (!store.state.computed.length) {
      const e = document.createElement('span');
      e.className = 'col-empty';
      e.textContent = 'No computed columns.';
      els.computedTags.appendChild(e);
      return;
    }
    for (const c of store.state.computed) {
      const tag = document.createElement('span');
      tag.className = 'col-tag';
      tag.title = c.expr;
      const label = document.createElement('span');
      label.textContent = c.id;
      tag.appendChild(label);
      const x = document.createElement('span');
      x.className = 'col-tag-x';
      x.textContent = '×';
      x.addEventListener('click', () => removeComputed(c.id));
      tag.appendChild(x);
      els.computedTags.appendChild(tag);
    }
  }

  function renderStatTags() {
    els.statTags.textContent = '';
    if (!store.state.stats.length) {
      const e = document.createElement('span');
      e.className = 'col-empty';
      e.textContent = 'No stat columns.';
      els.statTags.appendChild(e);
      return;
    }
    for (const s of store.state.stats) {
      const tag = document.createElement('span');
      tag.className = 'col-tag col-tag-stat';
      const label = document.createElement('span');
      // Matches analytics.py result key exactly: f"{fn}({field})".
      label.textContent = `${s.fn}(${s.field})`;
      tag.appendChild(label);
      const x = document.createElement('span');
      x.className = 'col-tag-x';
      x.textContent = '×';
      x.addEventListener('click', () => removeStat(s));
      tag.appendChild(x);
      els.statTags.appendChild(tag);
    }
  }

  function renderAll() {
    renderSelected();
    renderCatalog();
    renderComputedTags();
    renderStatTags();
  }

  // ---- Events.
  els.search.addEventListener('input', renderCatalog);
  els.cAdd.addEventListener('click', addComputed);
  els.cExpr.addEventListener('keydown', (e) => { if (e.key === 'Enter') addComputed(); });
  els.sAdd.addEventListener('click', addStat);
  els.apply.addEventListener('click', () => store.runScreen());

  // ---- Subscribe. Re-render only when our slices actually changed (compare
  // JSON) so external updates (presets) reflect here without render loops.
  let last = '';
  function snapshot() {
    const s = store.state;
    return JSON.stringify({
      columns: s.columns,
      computed: s.computed,
      stats: s.stats,
      fields: s.fields.length, // catalog arrives once; cheap change signal
    });
  }
  store.subscribe(() => {
    const snap = snapshot();
    if (snap === last) return;
    last = snap;
    renderStatFieldOptions();
    renderAll();
  });

  // ---- Discoverable launcher in the table toolbar. Jumps the rail to the
  // Columns tab (and reveals the rail if hidden) so the picker is easy to find.
  const toolbar = ctx.el('table-toolbar');
  if (toolbar && !toolbar.querySelector('.tbl-cols-btn')) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tbl-cols-btn';
    btn.innerHTML = '<span>columns</span>';
    btn.title = 'Choose columns. Add any of 1000+ fields, computed, or stat columns.';
    btn.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('neon:rail-show', { detail: { tab: 'Columns' } }));
      els.search.focus();
    });
    toolbar.appendChild(btn);
  }

  // Initial paint (catalog is already loaded by the time modules run).
  renderStatFieldOptions();
  renderAll();
  last = snapshot();
});
