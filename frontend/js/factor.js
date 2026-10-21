// factor.js - INTERACTIVE FACTOR BUILDER. Mounts in #factor-panel (left rail).
//
// The preset factor models live in presets.js. This is the CUSTOM builder: the
// user adds rows, each a numeric field + a weight + a HIGH/LOW direction, then
// hits BUILD SCORE. That writes store.factor and re-runs the screen. The backend
// computes a weighted z-score blend (factor_score) and auto-sorts by it desc.
//
// It also subscribes to the store so that when a factor PRESET is applied from
// presets.js (store.state.factor changes), the builder rows reflect that model.
//
// Registers as module 'factor'. No em dashes anywhere.

import { pickDefaultField } from './defaults.js';

// Numeric field types from the backend catalog that make sense to score on.
const NUMERIC_TYPES = new Set(['bignum', 'price', 'pct', 'num', 'int']);

function injectStyles() {
  if (document.getElementById('factor-styles')) return;
  const style = document.createElement('style');
  style.id = 'factor-styles';
  style.textContent = `
    .fac-root {
      display: flex;
      flex-direction: column;
      gap: var(--sp-2);
      min-height: 0;
    }
    .fac-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 700;
    }
    .fac-title { display: flex; align-items: center; gap: var(--sp-2); }
    .fac-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--muted);
      box-shadow: none;
      transition: background 0.15s ease, box-shadow 0.15s ease;
    }
    .fac-dot.is-on {
      background: var(--purple);
      box-shadow: 0 0 8px rgba(176, 38, 255, 0.7);
    }
    .fac-rows { display: flex; flex-direction: column; gap: var(--sp-2); }
    .fac-row {
      display: grid;
      grid-template-columns: 1fr 48px auto auto;
      gap: 6px;
      align-items: center;
      padding: 6px;
      background: var(--glass);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid var(--border-glass);
      border-radius: var(--radius-sm);
    }
    .fac-field {
      width: 100%;
      padding: 5px 6px;
      background: rgba(10, 10, 14, 0.8);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      color: var(--text);
      font-family: var(--font-mono);
      font-size: 12px;
      outline: none;
      cursor: pointer;
      transition: box-shadow 0.15s ease, border-color 0.15s ease;
    }
    .fac-field:hover { border-color: rgba(0, 240, 255, 0.4); }
    .fac-field:focus { border-color: var(--cyan); box-shadow: var(--glow-cyan); }
    .fac-weight {
      width: 100%;
      padding: 5px 4px;
      background: rgba(10, 10, 14, 0.8);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      color: var(--text);
      font-family: var(--font-mono);
      font-size: 12px;
      text-align: right;
      outline: none;
      transition: box-shadow 0.15s ease, border-color 0.15s ease;
    }
    .fac-weight:hover { border-color: rgba(0, 240, 255, 0.4); }
    .fac-weight:focus { border-color: var(--cyan); box-shadow: var(--glow-cyan); }
    .fac-dir {
      padding: 5px 8px;
      min-width: 46px;
      background: rgba(176, 38, 255, 0.08);
      border: 1px solid rgba(176, 38, 255, 0.4);
      border-radius: var(--radius-sm);
      color: var(--purple);
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.06em;
      cursor: pointer;
      user-select: none;
      transition: box-shadow 0.15s ease, border-color 0.15s ease, background 0.15s ease;
    }
    .fac-dir:hover { box-shadow: var(--glow-purple); }
    .fac-dir.is-low {
      background: rgba(255, 0, 60, 0.08);
      border-color: rgba(255, 0, 60, 0.4);
      color: var(--pink);
    }
    .fac-dir.is-low:hover { box-shadow: var(--glow-pink); }
    .fac-del {
      padding: 4px 7px;
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
    .fac-del:hover { color: var(--pink); border-color: rgba(255, 0, 60, 0.4); }
    .fac-actions { display: flex; gap: var(--sp-2); align-items: center; }
    .fac-add {
      flex: 1 1 auto;
      padding: 6px 10px;
      background: transparent;
      border: 1px dashed var(--line);
      border-radius: var(--radius-sm);
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.04em;
      cursor: pointer;
      transition: color 0.15s ease, border-color 0.15s ease;
    }
    .fac-add:hover { color: var(--cyan); border-color: rgba(0, 240, 255, 0.4); }
    .fac-build {
      width: 100%;
      padding: 8px 12px;
      background: rgba(176, 38, 255, 0.1);
      border: 1px solid rgba(176, 38, 255, 0.5);
      border-radius: var(--radius-sm);
      color: var(--purple);
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      cursor: pointer;
      box-shadow: 0 0 10px rgba(176, 38, 255, 0.25);
      transition: box-shadow 0.15s ease, border-color 0.15s ease, background 0.15s ease, transform 0.05s ease;
    }
    .fac-build:hover {
      border-color: var(--purple);
      box-shadow: var(--glow-purple);
      background: rgba(176, 38, 255, 0.18);
    }
    .fac-build:active { transform: translateY(1px); }
    .fac-clear {
      padding: 6px 10px;
      background: transparent;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: color 0.15s ease, border-color 0.15s ease;
    }
    .fac-clear:hover { color: var(--text); border-color: rgba(255, 0, 60, 0.4); }
    .fac-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--sp-2);
      padding: 6px 8px;
      background: rgba(176, 38, 255, 0.06);
      border: 1px solid rgba(176, 38, 255, 0.3);
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: 12px;
    }
    .fac-top .fac-top-k { color: var(--muted); letter-spacing: 0.06em; }
    .fac-top .fac-top-v { color: var(--purple); font-weight: 700; }
    .fac-top.hidden { display: none; }
  `;
  document.head.appendChild(style);
}

window.Screener.registerModule('factor', (ctx) => {
  const { store, el } = ctx;
  const panel = el('factor-panel');
  if (!panel) {
    console.warn('factor: #factor-panel not found, skipping.');
    return;
  }

  injectStyles();

  // The numeric fields the user can score on. Built once from the catalog.
  const numericFields = (store.state.fields || []).filter(
    (f) => f && NUMERIC_TYPES.has(f.type)
  );

  panel.classList.remove('slot-placeholder');
  panel.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'fac-root';

  // ---- Header with an active indicator dot.
  const head = document.createElement('div');
  head.className = 'fac-head';
  const titleWrap = document.createElement('div');
  titleWrap.className = 'fac-title';
  const dot = document.createElement('span');
  dot.className = 'fac-dot';
  const titleText = document.createElement('span');
  titleText.textContent = 'Factor Model';
  titleWrap.appendChild(dot);
  titleWrap.appendChild(titleText);
  head.appendChild(titleWrap);
  root.appendChild(head);

  // ---- Top factor_score readout (filled from result when a factor is active).
  const top = document.createElement('div');
  top.className = 'fac-top hidden';
  const topK = document.createElement('span');
  topK.className = 'fac-top-k';
  topK.textContent = 'TOP SCORE';
  const topV = document.createElement('span');
  topV.className = 'fac-top-v';
  top.appendChild(topK);
  top.appendChild(topV);
  root.appendChild(top);

  // ---- Rows container.
  const rowsWrap = document.createElement('div');
  rowsWrap.className = 'fac-rows';
  root.appendChild(rowsWrap);

  // ---- Add-row action.
  const actions = document.createElement('div');
  actions.className = 'fac-actions';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'fac-add';
  addBtn.textContent = '+ Add factor';
  actions.appendChild(addBtn);
  root.appendChild(actions);

  // ---- BUILD SCORE + Clear.
  const buildBtn = document.createElement('button');
  buildBtn.type = 'button';
  buildBtn.className = 'fac-build';
  buildBtn.textContent = 'Build Score';
  root.appendChild(buildBtn);

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'fac-clear';
  clearBtn.textContent = 'Clear factor';
  root.appendChild(clearBtn);

  panel.appendChild(root);

  // Guard: nothing to score on.
  if (!numericFields.length) {
    addBtn.disabled = true;
    buildBtn.disabled = true;
  }

  // ---- Build one row. weights item shape: {field, weight, dir}.
  function buildFieldSelect(selectedField) {
    if (!selectedField) {
      const used = [...rowsWrap.querySelectorAll('.fac-field')].map((x) => x.value);
      selectedField = pickDefaultField(numericFields, used, ['change', 'close']);
    }
    const sel = document.createElement('select');
    sel.className = 'fac-field';
    for (const f of numericFields) {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.label || f.id;
      if (f.id === selectedField) opt.selected = true;
      sel.appendChild(opt);
    }
    return sel;
  }

  function addRow(preset) {
    const item = preset || {};
    const row = document.createElement('div');
    row.className = 'fac-row';

    const fieldSel = buildFieldSelect(item.field);
    row.appendChild(fieldSel);

    const weightInput = document.createElement('input');
    weightInput.type = 'number';
    weightInput.step = 'any'; // decimals and negatives allowed
    weightInput.className = 'fac-weight';
    weightInput.value = item.weight != null ? String(item.weight) : '1';
    weightInput.setAttribute('aria-label', 'Factor weight');
    row.appendChild(weightInput);

    const dirBtn = document.createElement('button');
    dirBtn.type = 'button';
    dirBtn.className = 'fac-dir';
    const dir = item.dir === 'low' ? 'low' : 'high';
    dirBtn.dataset.dir = dir;
    dirBtn.classList.toggle('is-low', dir === 'low');
    dirBtn.textContent = dir === 'low' ? 'LOW' : 'HIGH';
    dirBtn.title = 'HIGH means bigger is better. LOW means smaller is better.';
    dirBtn.addEventListener('click', () => {
      const next = dirBtn.dataset.dir === 'high' ? 'low' : 'high';
      dirBtn.dataset.dir = next;
      dirBtn.classList.toggle('is-low', next === 'low');
      dirBtn.textContent = next === 'low' ? 'LOW' : 'HIGH';
    });
    row.appendChild(dirBtn);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'fac-del';
    del.textContent = '×'; // multiplication sign
    del.setAttribute('aria-label', 'Remove factor');
    del.addEventListener('click', () => row.remove());
    row.appendChild(del);

    rowsWrap.appendChild(row);
    return row;
  }

  // Read the current rows into the weights array. Skips rows with invalid
  // weights (non-numeric) so a half-typed value does not poison the model.
  function readRows() {
    const weights = [];
    for (const row of rowsWrap.querySelectorAll('.fac-row')) {
      const field = row.querySelector('.fac-field').value;
      const weightRaw = row.querySelector('.fac-weight').value;
      const weight = parseFloat(weightRaw);
      const dir = row.querySelector('.fac-dir').dataset.dir === 'low' ? 'low' : 'high';
      if (!field || !Number.isFinite(weight)) continue;
      weights.push({ field, weight, dir });
    }
    return weights;
  }

  addBtn.addEventListener('click', () => addRow());

  buildBtn.addEventListener('click', () => {
    const weights = readRows();
    if (!weights.length) {
      window.Screener.toast('Add at least one factor with a numeric weight.', {
        title: 'Empty model',
        kind: 'info',
      });
      return;
    }
    // The exact patch: a factor with the row weights. Backend computes
    // factor_score and auto-sorts by it desc on the next runScreen.
    store.set({ factor: { weights } });
    store.runScreen();
  });

  clearBtn.addEventListener('click', () => {
    store.set({ factor: null });
    store.runScreen();
  });

  // ---- Render rows from a factor model (used on init and on preset apply).
  function renderFromFactor(factor) {
    rowsWrap.innerHTML = '';
    const weights = (factor && Array.isArray(factor.weights) && factor.weights) || [];
    if (weights.length) {
      for (const w of weights) addRow(w);
    } else {
      // Start with one empty row so the builder is never blank.
      addRow();
    }
  }

  // Update the active dot and the top-score readout from store state.
  function syncIndicators() {
    const s = store.state;
    const active = !!(s.factor && s.factor.weights && s.factor.weights.length);
    dot.classList.toggle('is-on', active);

    let topScore = null;
    const result = s.result;
    if (active && result && Array.isArray(result.rows) && result.rows.length) {
      for (const r of result.rows) {
        const v = r && r.factor_score;
        if (typeof v === 'number' && Number.isFinite(v)) {
          if (topScore == null || v > topScore) topScore = v;
        }
      }
    }
    if (topScore != null) {
      topV.textContent = topScore.toFixed(2);
      top.classList.remove('hidden');
    } else {
      top.classList.add('hidden');
    }
  }

  // ---- React to factor changes from elsewhere (presets.js applies a factor).
  // Track the last factor we rendered so we only rebuild rows when the model
  // actually changes, not on every unrelated store notification.
  let lastFactorSnap = null;
  function snap(factor) {
    try {
      return JSON.stringify((factor && factor.weights) || null);
    } catch (_e) {
      return '';
    }
  }

  store.subscribe(() => {
    const cur = snap(store.state.factor);
    if (cur !== lastFactorSnap) {
      lastFactorSnap = cur;
      renderFromFactor(store.state.factor);
    }
    syncIndicators();
  });

  // ---- Initial render from whatever factor is already in the store.
  lastFactorSnap = snap(store.state.factor);
  renderFromFactor(store.state.factor);
  syncIndicators();
});
