// markets.js — the MARKET SWITCHER. A neon segmented control that mounts in
// #market-switcher, one pill per market from store.state.markets. Clicking a
// pill switches the active market (and resets columns to a market-appropriate
// default) then re-runs the screen. The active pill tracks store.state.market
// so a preset that changes market keeps the control in sync.
//
// Registers as module 'markets'. No em dashes anywhere.

// ---- Default columns per market. Mirrors backend DEFAULT_COLUMNS / MARKET_FIELDS
// so the column set actually populates for the chosen market.
const DEFAULT_COLUMNS = {
  america: ['name', 'description', 'close', 'change', 'volume', 'market_cap_basic', 'price_earnings_ttm', 'sector'],
  crypto: ['name', 'close', 'change', 'volume', 'market_cap_calc', 'Value.Traded'],
  forex: ['name', 'close', 'change', 'high', 'low'],
  futures: ['name', 'close', 'change', 'volume', 'high', 'low'],
  bond: ['name', 'close', 'change', 'high', 'low'],
  cfd: ['name', 'close', 'change', 'high', 'low'],
};

// Generic safe fallback used when a market is not in the map above. Stocks get a
// market cap, everything else stays on price and volume.
function defaultColumnsForMarket(marketId, store) {
  if (DEFAULT_COLUMNS[marketId]) return DEFAULT_COLUMNS[marketId].slice();

  const idx = (store && store.state && store.state.fieldIndex) || {};
  const has = (id) => !!idx[id];
  const kind = marketKind(marketId, store);

  const base = ['name', 'close', 'change', 'volume'];
  if (kind === 'stocks' && has('market_cap_basic')) base.push('market_cap_basic');
  // Only keep columns the catalog actually knows about (when an index exists).
  if (Object.keys(idx).length) return base.filter((id) => id === 'name' || has(id));
  return base;
}

function marketKind(marketId, store) {
  const markets = (store && store.state && store.state.markets) || [];
  const m = markets.find((x) => x.id === marketId);
  return (m && m.kind) || '';
}

// ---- Styles. Neon segmented control with a glowing active pill.
function injectStyles() {
  if (document.getElementById('markets-styles')) return;
  const style = document.createElement('style');
  style.id = 'markets-styles';
  style.textContent = `
    .mkt-switcher {
      display: flex;
      align-items: center;
      gap: var(--sp-2);
    }
    .mkt-label {
      font-size: 10px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 600;
    }
    .mkt-seg {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 3px;
      background: var(--glass);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid var(--border-glass);
      border-radius: var(--radius);
      box-shadow: var(--shadow-soft);
    }
    .mkt-pill {
      appearance: none;
      padding: 5px 12px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      color: var(--muted);
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      cursor: pointer;
      white-space: nowrap;
      transition: color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
    }
    .mkt-pill:hover {
      color: var(--text);
      border-color: rgba(0, 240, 255, 0.4);
      box-shadow: var(--glow-cyan);
    }
    .mkt-pill.is-active {
      color: var(--cyan);
      background: rgba(0, 240, 255, 0.1);
      border-color: var(--cyan);
      box-shadow: var(--glow-cyan);
    }
    .mkt-pill:focus-visible {
      outline: none;
      border-color: var(--cyan);
      box-shadow: var(--glow-cyan);
    }
  `;
  document.head.appendChild(style);
}

// ---- Module registration. Runs after bootstrap, so markets/fields exist.
window.Screener.registerModule('markets', (ctx) => {
  const { store, el } = ctx;
  const host = el('market-switcher');
  if (!host) {
    console.warn('markets: #market-switcher not found, skipping.');
    return;
  }

  const markets = (store.state.markets || []).slice();
  if (!markets.length) {
    console.warn('markets: store.state.markets empty, skipping.');
    return;
  }

  injectStyles();

  host.classList.remove('slot-placeholder');
  host.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'mkt-switcher';

  const label = document.createElement('span');
  label.className = 'mkt-label';
  label.textContent = 'Market';
  wrap.appendChild(label);

  const seg = document.createElement('div');
  seg.className = 'mkt-seg';
  seg.setAttribute('role', 'tablist');

  const pills = new Map(); // marketId -> button

  for (const m of markets) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'mkt-pill';
    pill.setAttribute('role', 'tab');
    pill.dataset.market = m.id;
    pill.textContent = m.label || m.id;
    pill.title = m.label || m.id;
    pill.addEventListener('click', () => {
      if (store.state.market === m.id) return;
      store.setMarket(m.id, defaultColumnsForMarket(m.id, store));
    });
    pills.set(m.id, pill);
    seg.appendChild(pill);
  }

  wrap.appendChild(seg);
  host.appendChild(wrap);

  // Reflect the active market (it can change via a preset elsewhere).
  function syncActive() {
    const active = store.state.market;
    for (const [id, pill] of pills) {
      const on = id === active;
      pill.classList.toggle('is-active', on);
      pill.setAttribute('aria-selected', on ? 'true' : 'false');
    }
  }

  syncActive();
  store.subscribe(syncActive);
});
