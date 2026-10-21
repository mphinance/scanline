// openin.js - "Open in TradingView".
//
// One link, straight to the live TradingView chart for the row's symbol. Pure
// TradingView: this is a TradingView showcase, so the handoff goes into
// TradingView, not to any third party.
//
// chartUrl(row) is pure and unit tested. mountButton() renders the link and is
// attached to window.Screener.openIn so the detail drawer (and later, a row
// hover action) can drop it in.
//
// No em dashes anywhere.

// Rows carry both `name` (bare symbol, e.g. "NVDA") and `ticker` (exchange
// prefixed, e.g. "NASDAQ:NVDA"). TradingView's chart wants the prefixed form
// when we have it, so a click lands on the right exchange's symbol.
export function chartUrl(row) {
  if (!row) return '';
  const full = (row.ticker || row.name || '').toString().trim();
  if (!full) return '';
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(full)}`;
}

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('openin-styles')) return;
  const style = document.createElement('style');
  style.id = 'openin-styles';
  style.textContent = `
.oi-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 10px;
  background: rgba(0, 240, 255, 0.07);
  border: 1px solid rgba(0, 240, 255, 0.4);
  border-radius: var(--radius-sm);
  color: var(--cyan);
  font-family: var(--font-mono); font-size: 12px; font-weight: 600;
  letter-spacing: 0.04em; text-transform: uppercase;
  text-decoration: none; cursor: pointer;
  transition: box-shadow .15s ease, border-color .15s ease, background .15s ease;
}
.oi-btn:hover { border-color: var(--cyan); box-shadow: var(--glow-cyan); background: rgba(0,240,255,.14); }
.oi-btn .oi-ext { font-size: 12px; opacity: .85; }
`;
  document.head.appendChild(style);
}

// mountButton(host, row): render the single "Open in TradingView" link.
export function mountButton(host, row) {
  if (!host) return;
  const href = chartUrl(row);
  if (!href) return;
  injectStyles();
  host.innerHTML = '';
  const a = document.createElement('a');
  a.className = 'oi-btn';
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.innerHTML = 'Open in TradingView <span class="oi-ext">&#8599;</span>';
  host.appendChild(a);
}

// Expose for the detail drawer and future callers.
if (typeof window !== 'undefined') {
  window.Screener = window.Screener || {};
  window.Screener.openIn = { chartUrl, mountButton };
}
