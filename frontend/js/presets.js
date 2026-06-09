// presets.js — the PRESET SCAN LIBRARY. Mounts in #preset-panel (left rail).
// Two sections:
//   PRESET SCANS   one-click scans from store.state.presets. A click writes the
//                  preset config into the store and re-runs the screen.
//   FACTOR MODELS  weighted multi-factor models from store.state.factorPresets.
//                  A click sets store.factor and re-runs (backend auto-sorts by
//                  factor_score).
// A search input filters preset cards by name and description. The last-applied
// preset / factor is highlighted, and the highlight clears if the user changes
// filters elsewhere.
//
// Registers as module 'presets'. No em dashes anywhere.

// ---- Default columns per market, so applying a preset with no market change
// still lands on a column set the chosen market populates. Mirrors backend.
const DEFAULT_COLUMNS = {
  america: ['name', 'description', 'close', 'change', 'volume', 'market_cap_basic', 'price_earnings_ttm', 'sector'],
  crypto: ['name', 'close', 'change', 'volume', 'market_cap_calc', 'Value.Traded'],
  forex: ['name', 'close', 'change', 'high', 'low'],
  futures: ['name', 'close', 'change', 'volume', 'high', 'low'],
  bond: ['name', 'close', 'change', 'high', 'low'],
  cfd: ['name', 'close', 'change', 'high', 'low'],
};

function injectStyles() {
  if (document.getElementById('presets-styles')) return;
  const style = document.createElement('style');
  style.id = 'presets-styles';
  style.textContent = `
    .pst-root {
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
      min-height: 0;
    }
    .pst-section { display: flex; flex-direction: column; gap: var(--sp-2); }
    .pst-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 10px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 700;
    }
    .pst-count {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--muted);
      opacity: 0.8;
    }
    .pst-search {
      width: 100%;
      padding: 6px 10px;
      background: rgba(10, 10, 14, 0.8);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      color: var(--text);
      font-family: var(--font-mono);
      font-size: 11px;
      outline: none;
      transition: box-shadow 0.15s ease, border-color 0.15s ease;
    }
    .pst-search:hover { border-color: rgba(0, 240, 255, 0.4); }
    .pst-search:focus { border-color: var(--cyan); box-shadow: var(--glow-cyan); }
    .pst-list { display: flex; flex-direction: column; gap: var(--sp-2); }
    .pst-card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 8px 10px;
      background: var(--glass);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid var(--border-glass);
      border-left: 2px solid transparent;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease, transform 0.05s ease;
    }
    .pst-card:hover {
      border-color: rgba(0, 240, 255, 0.45);
      box-shadow: var(--glow-cyan);
      background: rgba(0, 240, 255, 0.05);
    }
    .pst-card:active { transform: translateY(1px); }
    .pst-card.is-active {
      border-color: var(--cyan);
      border-left-color: var(--cyan);
      box-shadow: var(--glow-cyan);
      background: rgba(0, 240, 255, 0.08);
    }
    .pst-card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--sp-2);
    }
    .pst-name {
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 600;
      color: var(--cyan);
      letter-spacing: 0.02em;
    }
    .pst-card.is-active .pst-name { text-shadow: 0 0 8px rgba(0, 240, 255, 0.5); }
    .pst-desc {
      font-size: 11px;
      color: var(--muted);
      line-height: 1.35;
    }
    .pst-tag {
      flex: 0 0 auto;
      padding: 1px 6px;
      border-radius: 999px;
      font-family: var(--font-mono);
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--muted);
      border: 1px solid var(--line);
    }
    /* Factor cards lean purple to read as a distinct tool. */
    .pst-card.pst-factor .pst-name { color: var(--purple); }
    .pst-card.pst-factor:hover {
      border-color: rgba(176, 38, 255, 0.5);
      box-shadow: var(--glow-purple);
      background: rgba(176, 38, 255, 0.06);
    }
    .pst-card.pst-factor.is-active {
      border-color: var(--purple);
      border-left-color: var(--purple);
      box-shadow: var(--glow-purple);
      background: rgba(176, 38, 255, 0.1);
    }
    .pst-card.pst-factor.is-active .pst-name { text-shadow: 0 0 8px rgba(176, 38, 255, 0.5); }
    .pst-weights {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--muted);
      opacity: 0.85;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pst-empty {
      padding: var(--sp-2);
      font-size: 11px;
      color: var(--muted);
      text-align: center;
      letter-spacing: 0.03em;
    }
  `;
  document.head.appendChild(style);
}

function fieldLabel(fieldId, store) {
  const idx = (store.state && store.state.fieldIndex) || {};
  return (idx[fieldId] && idx[fieldId].label) || fieldId;
}

window.Screener.registerModule('presets', (ctx) => {
  const { store, el } = ctx;
  const panel = el('preset-panel');
  if (!panel) {
    console.warn('presets: #preset-panel not found, skipping.');
    return;
  }

  injectStyles();

  const presets = (store.state.presets || []).slice();
  const factorPresets = (store.state.factorPresets || []).slice();

  // Tracks the last-applied items so we can highlight them. Cleared when the
  // user mutates the relevant config from elsewhere.
  let activePresetId = null;
  let activeFactorId = null;

  panel.classList.remove('slot-placeholder');
  panel.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'pst-root';

  // ---- PRESET SCANS section
  const scanSection = document.createElement('div');
  scanSection.className = 'pst-section';

  const scanHead = document.createElement('div');
  scanHead.className = 'pst-head';
  const scanTitle = document.createElement('span');
  scanTitle.textContent = 'Preset Scans';
  const scanCount = document.createElement('span');
  scanCount.className = 'pst-count';
  scanCount.textContent = String(presets.length);
  scanHead.appendChild(scanTitle);
  scanHead.appendChild(scanCount);
  scanSection.appendChild(scanHead);

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'pst-search';
  search.placeholder = 'Search scans';
  search.setAttribute('aria-label', 'Search preset scans');
  scanSection.appendChild(search);

  const scanList = document.createElement('div');
  scanList.className = 'pst-list';
  scanSection.appendChild(scanList);

  const presetCards = new Map(); // preset.id -> { card, preset }

  function applyPreset(preset) {
    const market = preset.market || store.state.market;
    let columns = Array.isArray(preset.columns) ? preset.columns.slice() : null;
    if (!columns || !columns.length) {
      columns = (DEFAULT_COLUMNS[market] || DEFAULT_COLUMNS.america).slice();
    }
    // Writing market into the same patch means buildScreenBody() uses the
    // per-market query path on the very next runScreen. No separate setMarket
    // call needed, and the columns the preset wants are preserved (setMarket
    // would otherwise overwrite them with its own defaults).
    store.set({
      market,
      columns,
      filters: Array.isArray(preset.filters) ? preset.filters.slice() : [],
      match: preset.match || 'all',
      sort: Array.isArray(preset.sort) ? preset.sort.slice() : [],
      factor: null,
      computed: [],
      stats: [],
    });
    activePresetId = preset.id;
    activeFactorId = null;
    syncActive();
    store.runScreen();
  }

  for (const preset of presets) {
    const card = document.createElement('div');
    card.className = 'pst-card';
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.dataset.presetId = preset.id;

    const top = document.createElement('div');
    top.className = 'pst-card-top';
    const name = document.createElement('span');
    name.className = 'pst-name';
    name.textContent = preset.name || preset.id;
    top.appendChild(name);
    if (preset.market) {
      const tag = document.createElement('span');
      tag.className = 'pst-tag';
      tag.textContent = preset.market;
      top.appendChild(tag);
    }
    card.appendChild(top);

    if (preset.description) {
      const desc = document.createElement('div');
      desc.className = 'pst-desc';
      desc.textContent = preset.description;
      card.appendChild(desc);
    }

    card.addEventListener('click', () => applyPreset(preset));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        applyPreset(preset);
      }
    });

    presetCards.set(preset.id, { card, preset });
    scanList.appendChild(card);
  }

  if (!presets.length) {
    const empty = document.createElement('div');
    empty.className = 'pst-empty';
    empty.textContent = 'No preset scans available.';
    scanList.appendChild(empty);
  }

  // Filter cards by name + description.
  function applyFilter() {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const { card, preset } of presetCards.values()) {
      const hay = ((preset.name || '') + ' ' + (preset.description || '')).toLowerCase();
      const match = !q || hay.includes(q);
      card.classList.toggle('hidden', !match);
      if (match) shown += 1;
    }
    scanCount.textContent = q ? `${shown}/${presets.length}` : String(presets.length);
  }
  search.addEventListener('input', applyFilter);

  root.appendChild(scanSection);

  // ---- FACTOR MODELS section
  const factorSection = document.createElement('div');
  factorSection.className = 'pst-section';

  const factorHead = document.createElement('div');
  factorHead.className = 'pst-head';
  const factorTitle = document.createElement('span');
  factorTitle.textContent = 'Factor Models';
  const factorCount = document.createElement('span');
  factorCount.className = 'pst-count';
  factorCount.textContent = String(factorPresets.length);
  factorHead.appendChild(factorTitle);
  factorHead.appendChild(factorCount);
  factorSection.appendChild(factorHead);

  const factorList = document.createElement('div');
  factorList.className = 'pst-list';
  factorSection.appendChild(factorList);

  const factorCards = new Map(); // fp.id -> { card, fp }

  function applyFactor(fp) {
    if (!fp.weights || !fp.weights.length) return;
    store.set({ factor: { weights: fp.weights.slice() } });
    activeFactorId = fp.id;
    activePresetId = null;
    syncActive();
    store.runScreen();
  }

  for (const fp of factorPresets) {
    const card = document.createElement('div');
    card.className = 'pst-card pst-factor';
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.dataset.factorId = fp.id;

    const top = document.createElement('div');
    top.className = 'pst-card-top';
    const name = document.createElement('span');
    name.className = 'pst-name';
    name.textContent = fp.name || fp.id;
    top.appendChild(name);
    const tag = document.createElement('span');
    tag.className = 'pst-tag';
    tag.textContent = (fp.weights ? fp.weights.length : 0) + ' factors';
    top.appendChild(tag);
    card.appendChild(top);

    if (fp.weights && fp.weights.length) {
      const w = document.createElement('div');
      w.className = 'pst-weights';
      const parts = fp.weights.map((x) => {
        const arrow = x.dir === 'low' ? 'v' : '^';
        return fieldLabel(x.field, store) + ' ' + arrow;
      });
      w.textContent = parts.join(' . ');
      w.title = parts.join('  /  ');
      card.appendChild(w);
    }

    card.addEventListener('click', () => applyFactor(fp));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        applyFactor(fp);
      }
    });

    factorCards.set(fp.id, { card, fp });
    factorList.appendChild(card);
  }

  if (!factorPresets.length) {
    const empty = document.createElement('div');
    empty.className = 'pst-empty';
    empty.textContent = 'No factor models available.';
    factorList.appendChild(empty);
  }

  root.appendChild(factorSection);
  panel.appendChild(root);

  function syncActive() {
    for (const { card } of presetCards.values()) {
      card.classList.toggle('is-active', card.dataset.presetId === activePresetId);
    }
    for (const { card } of factorCards.values()) {
      card.classList.toggle('is-active', card.dataset.factorId === activeFactorId);
    }
  }

  // ---- Clear the highlight when the config no longer matches what we applied.
  // We snapshot the store config at apply time (via serialized compare) and, on
  // any store change, drop the highlight if filters / match / sort / factor have
  // diverged from the active preset / factor.
  function snapshot(obj) {
    try { return JSON.stringify(obj); } catch (_e) { return ''; }
  }

  function configMatchesPreset(preset) {
    const s = store.state;
    if ((preset.market || s.market) !== s.market) return false;
    if (snapshot(preset.filters || []) !== snapshot(s.filters || [])) return false;
    if ((preset.match || 'all') !== s.match) return false;
    if (snapshot(preset.sort || []) !== snapshot(s.sort || [])) return false;
    if (s.factor) return false; // a factor is active, not a plain preset
    return true;
  }

  function configMatchesFactor(fp) {
    const s = store.state;
    if (!s.factor || !s.factor.weights) return false;
    return snapshot(s.factor.weights) === snapshot(fp.weights || []);
  }

  store.subscribe(() => {
    if (activePresetId) {
      const entry = presetCards.get(activePresetId);
      if (!entry || !configMatchesPreset(entry.preset)) {
        activePresetId = null;
        syncActive();
      }
    }
    if (activeFactorId) {
      const entry = factorCards.get(activeFactorId);
      if (!entry || !configMatchesFactor(entry.fp)) {
        activeFactorId = null;
        syncActive();
      }
    }
  });

  applyFilter();
  syncActive();
});
