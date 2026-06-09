// timeframes.js - Multi-timeframe column toggles.
//
// The upstream scanner accepts a timeframe suffix on price and technical
// field ids, e.g. "RSI|1W", "close|60", "change|1M". This module renders a
// compact bar in the table toolbar that lets the user view technical columns
// across several timeframes side by side. Enabling a timeframe (say 1W) adds a
// suffixed sibling column for every currently selected suffixable base column,
// inserted right after its base. Disabling removes them again.
//
// 1D is the implicit, always-on base (the unsuffixed columns). It is shown as
// a static, non-toggling chip for clarity.

// ---- Timeframe options. code = backend suffix; label = what the user sees.
// 1D has no suffix (it is the base). 1H/4H map to minute-bar suffixes.
const TIMEFRAMES = [
  { key: '1D', label: '1D', suffix: null }, // base, always implicitly on
  { key: '1W', label: '1W', suffix: '1W' },
  { key: '1M', label: '1M', suffix: '1M' },
  { key: '1H', label: '1H', suffix: '60' },
  { key: '4H', label: '4H', suffix: '240' },
];

// Map from suffix -> timeframe key, used when reconciling existing columns.
const SUFFIX_TO_KEY = {};
for (const tf of TIMEFRAMES) {
  if (tf.suffix) SUFFIX_TO_KEY[tf.suffix] = tf.key;
}
const ALL_SUFFIXES = TIMEFRAMES.filter((t) => t.suffix).map((t) => t.suffix);

// ---- Groups whose fields make sense across timeframes. A suffix on a
// fundamental or identity field (e.g. market_cap_basic|1W) is meaningless, so
// those are excluded. Base price ids are always suffixable regardless of how
// the catalog happens to group them.
const SUFFIXABLE_GROUPS = new Set([
  'Price',
  'Performance',
  'Technicals',
  'MovingAverages',
  'Oscillators',
  'Volatility',
  'Volume',
]);
const SUFFIXABLE_BASE_IDS = new Set(['change', 'close', 'open', 'high', 'low']);

// Module-level set of active non-1D timeframe keys.
const active = new Set();

// ---- Split a column id into its base id and suffix (or null).
// "RSI|1W" -> { base: "RSI", suffix: "1W" }; "RSI" -> { base: "RSI", suffix: null }.
function splitColumn(colId) {
  const i = colId.indexOf('|');
  if (i === -1) return { base: colId, suffix: null };
  return { base: colId.slice(0, i), suffix: colId.slice(i + 1) };
}

// ---- Is a given base field id suffixable? Checks the explicit base-id allow
// list first, then the field group from the catalog index.
function isSuffixable(baseId, fieldIndex) {
  if (SUFFIXABLE_BASE_IDS.has(baseId)) return true;
  const meta = fieldIndex && fieldIndex[baseId];
  if (!meta) return false;
  return SUFFIXABLE_GROUPS.has(meta.group);
}

// ---- Compute the desired column list from the current base columns and the
// active timeframe set. Strips every known timeframe suffix first (so inactive
// ones are removed), then for each surviving base column appends its variants
// for the active timeframes, in TIMEFRAMES order, right after the base.
function reconcileColumns(columns, fieldIndex) {
  // 1. Extract the ordered list of base columns (drop any suffixed column we
  //    manage). Unknown suffixes (not ours) are left untouched as bases.
  const bases = [];
  const seen = new Set();
  for (const col of columns) {
    const { base, suffix } = splitColumn(col);
    if (suffix && SUFFIX_TO_KEY[suffix]) continue; // a managed variant; drop it
    if (seen.has(col)) continue;
    seen.add(col);
    bases.push(col);
  }

  // 2. Rebuild: base, then its active-timeframe variants (only if suffixable).
  const out = [];
  for (const baseCol of bases) {
    out.push(baseCol);
    if (!isSuffixable(baseCol, fieldIndex)) continue;
    for (const tf of TIMEFRAMES) {
      if (!tf.suffix) continue;
      if (!active.has(tf.key)) continue;
      out.push(baseCol + '|' + tf.suffix);
    }
  }
  return out;
}

// ---- Count how many variants a timeframe would add for the current bases.
// Used to guard against enabling a timeframe that produces zero new columns.
function countVariantsFor(tfKey, columns, fieldIndex) {
  let n = 0;
  const seen = new Set();
  for (const col of columns) {
    const { base, suffix } = splitColumn(col);
    if (suffix && SUFFIX_TO_KEY[suffix]) continue;
    if (seen.has(col)) continue;
    seen.add(col);
    if (isSuffixable(col, fieldIndex)) n += 1;
  }
  return n;
}

// ---- Apply the current active set to the store, but only if the desired
// column list actually differs from the current one. Comparing before writing
// keeps this idempotent and loop-safe under the store subscription.
function applyReconcile(store) {
  const current = store.state.columns || [];
  const desired = reconcileColumns(current, store.state.fieldIndex);
  if (JSON.stringify(desired) === JSON.stringify(current)) return false;
  store.set({ columns: desired });
  return true;
}

function buildStyles() {
  if (document.getElementById('timeframes-styles')) return;
  const style = document.createElement('style');
  style.id = 'timeframes-styles';
  style.textContent = `
.tf-bar {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 4px 8px;
  background: var(--glass);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-sm);
}
.tf-label {
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
}
.tf-buttons {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
}
.tf-btn {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 3px 9px;
  background: rgba(10, 10, 14, 0.6);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  color: var(--muted);
  cursor: pointer;
  transition: box-shadow 0.15s ease, border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
  user-select: none;
}
.tf-btn:hover {
  color: var(--text);
  border-color: rgba(0, 240, 255, 0.4);
}
.tf-btn.tf-active {
  color: var(--cyan);
  border-color: var(--cyan);
  background: rgba(0, 240, 255, 0.1);
  box-shadow: var(--glow-cyan);
}
/* 1D is the implicit base. Always-on, not interactive. */
.tf-btn.tf-base {
  color: var(--cyan);
  border-color: rgba(0, 240, 255, 0.35);
  background: rgba(0, 240, 255, 0.06);
  cursor: default;
}
.tf-btn.tf-base:hover {
  color: var(--cyan);
  border-color: rgba(0, 240, 255, 0.35);
}
`;
  document.head.appendChild(style);
}

window.Screener.registerModule('timeframes', (ctx) => {
  const { store, el } = ctx;
  const mount = el('table-toolbar');
  if (!mount) {
    console.warn('timeframes: #table-toolbar not found; module inactive.');
    return;
  }

  buildStyles();

  // Build our own child container so we never wipe siblings (app.js may add a
  // Run button into the same toolbar).
  const bar = document.createElement('div');
  bar.className = 'tf-bar';
  bar.id = 'tf-bar';

  const label = document.createElement('span');
  label.className = 'tf-label';
  label.textContent = 'TIMEFRAMES';
  bar.appendChild(label);

  const buttons = document.createElement('div');
  buttons.className = 'tf-buttons';
  bar.appendChild(buttons);

  const btnByKey = {};
  for (const tf of TIMEFRAMES) {
    const b = document.createElement('button');
    b.className = 'tf-btn';
    b.type = 'button';
    b.textContent = tf.label;
    b.dataset.tf = tf.key;

    if (!tf.suffix) {
      // 1D: implicit base, always on and not toggleable.
      b.classList.add('tf-base', 'tf-active');
      b.title = 'Base timeframe (always on)';
      b.setAttribute('aria-disabled', 'true');
    } else {
      b.title = 'Toggle ' + tf.label + ' columns';
      b.addEventListener('click', () => toggle(tf.key));
    }

    buttons.appendChild(b);
    btnByKey[tf.key] = b;
  }

  mount.appendChild(bar);

  function syncButtonStates() {
    for (const tf of TIMEFRAMES) {
      if (!tf.suffix) continue;
      const b = btnByKey[tf.key];
      if (active.has(tf.key)) b.classList.add('tf-active');
      else b.classList.remove('tf-active');
    }
  }

  function toggle(tfKey) {
    if (active.has(tfKey)) {
      active.delete(tfKey);
      syncButtonStates();
      applyReconcile(store);
      store.runScreen();
      return;
    }

    // Enabling: guard against adding zero columns (no suffixable base present).
    const n = countVariantsFor(tfKey, store.state.columns || [], store.state.fieldIndex);
    if (n === 0) {
      window.Screener.toast('Add a technical column first', { title: 'Timeframes', kind: 'info' });
      return; // leave the toggle visually off
    }

    active.add(tfKey);
    syncButtonStates();
    applyReconcile(store);
    store.runScreen();
  }

  // ---- Subscribe so that if the user adds a new suffixable base column
  // elsewhere while a timeframe is active, its variants get added on the next
  // change. applyReconcile compares desired vs current before writing, so this
  // never loops: once columns match the desired set, set() is not called.
  let reconciling = false;
  store.subscribe(() => {
    if (!active.size) return; // nothing to maintain
    if (reconciling) return; // re-entrancy guard
    reconciling = true;
    try {
      applyReconcile(store);
    } finally {
      reconciling = false;
    }
  });
});
