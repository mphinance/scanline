# SPEC - SCANLINE

> A market screener with a quant-analytics layer on top of TradingView's data, in a synthwave /
> TraderDaddy / Bloomberg-terminal aesthetic.

## Goal
A single-page, real-data market screener that goes far beyond filtering: custom computed
columns, multi-key sorting, in-result statistics (z-score, percentile rank, composite factor
scoring), conditional heatmap formatting, summary-stat footers, saved screens, watchlists, and
CSV export. Powered by the `tradingview-screener` Python package (live, no-auth delayed data;
optional cookie for real-time).

## Stack
- **Backend:** FastAPI + uvicorn. Thin service wrapper over `tradingview-screener`. In-memory TTL cache.
- **Frontend:** Vanilla JS (ES modules) + hand-rolled synthwave CSS. **No build step.** Served as static files by FastAPI.
- **Data:** `tradingview_screener.Query` → `(count, pandas.DataFrame)`. Markets: stocks (america + 70 countries), crypto, forex, futures, bonds, cfd, coin.

## The "not a clone" pillar - analytics & math (FIRST CLASS)
This is what makes it ours, not TradingView's:
1. **Computed columns / formula engine.** User defines derived columns with a safe expression
   language over existing fields, e.g. `(high-low)/close*100`, `close/sma50`, `volume*close`.
   Evaluated server-side with a sandboxed AST evaluator (no `eval`). Operators `+ - * / % **`,
   parens, and functions `abs min max log ln sqrt round`.
2. **In-result statistics.** For any numeric column, compute across the returned set: `zscore`,
   `pctrank` (0-100 percentile), `rank`, normalized `0..1`. Exposed as virtual columns
   `zscore(field)`, `pctrank(field)`.
3. **Composite factor score.** Weighted multi-factor ranking: user assigns weights to N fields
   (each normalized by z-score, direction-aware), backend returns a `factor_score` column and
   ranks by it. Ships with presets (Momentum, Value, Quality, Growth, Low-Vol).
4. **Multi-key sort.** Sort by column A asc, then B desc, then C - stable, client-side, with
   visual sort-order badges.
5. **Advanced client-side filtering.** On top of server results: per-column range sliders, quick
   numeric/text filters, and derived-column filters - instant, no round-trip.
6. **Summary-stat footer.** Per numeric column: count, mean, median, min, max, stdev, sum.
   Recomputes on filter.
7. **Conditional formatting.** Heatmap gradient (neon green→pink) per column by value, z-score, or
   percentile; bar-in-cell mode; positive/negative coloring for change fields.

## Feature surface ("most complete")
- Visual **filter builder**: any field, full operator set incl. crosses/between/isin, AND/OR groups.
- **Multi-market** switcher (stocks/crypto/forex/futures/bonds/cfd).
- **Field catalog**: ~160 curated, grouped, typed fields (price, performance, valuation,
  profitability, dividends, technicals/MA/oscillators, volume, fundamentals) + search.
- **Column picker**: add/remove/reorder columns; computed columns; stat columns.
- Dense, sortable, virtualized neon **data table**; sparklines; row detail drawer.
- **~22 one-click preset scans**: top gainers/losers, unusual volume, RSI oversold/overbought,
  52-wk highs/lows, gap-ups, golden/death cross, high short interest, dividend aristocrats,
  oversold mega-caps, crypto movers, momentum leaders, value plays, breakouts, etc.
- **Saved screens** + **watchlist** (localStorage). **CSV export**. **Auto-refresh** (configurable).
- **Command palette** (Ctrl/Cmd-K) + full keyboard nav.

## Voice / style rules (subagents self-enforce)
- Synthwave aesthetic per `mph-synthwave-theme`: bg `#0a0a0c`, panels `#121216` / glass, neon
  cyan `#00f0ff`, pink `#ff003c`, green `#00ff88`, purple `#b026ff`. JetBrains Mono for ALL
  numbers/tickers/tables; Inter for UI. Glassmorphism + neon glow on interactives. Slight rounding (4-8px).
- **NO em dashes anywhere** (code comments, UI copy, docs). Use periods/commas/"and".
- **No markdown tables** in any `.md` deliverable meant for Substack - N/A here, plain docs fine.
- High-density terminal layout. Monospace columns align.

## API contract (backend → frontend)
- `GET  /api/markets` → `[{id,label,kind}]`
- `GET  /api/fields` → `[{id,label,group,type,unit}]` (the catalog)
- `GET  /api/presets` → `[{id,name,description,market,query}]`
- `POST /api/screen` body:
  ```json
  {"market":"america","columns":["name","close",...],
   "filters":[{"field":"market_cap_basic","op":">","value":1e9}, ...],
   "match":"all|any",
   "computed":[{"id":"range_pct","expr":"(high-low)/close*100"}],
   "stats":[{"fn":"zscore","field":"change"}],
   "factor":{"weights":[{"field":"change","weight":1,"dir":"high"}, ...]},
   "sort":[{"field":"volume","dir":"desc"}],
   "limit":150,"offset":0}
  ```
  → `{"count":int,"rows":[{...}],"columns":[...],"meta":{...}}`
- `GET  /api/health` → `{"ok":true,...}`
- Static frontend served at `/`.

## Acceptance criteria
- A real query returns real rows in the UI within seconds, no auth.
- Computed columns, z-score/pctrank stat columns, and factor scoring all produce correct numbers
  (verified against hand calc on a small set).
- Multi-key sort, client filters, summary footer, conditional formatting all work live in-browser.
- Looks unmistakably like a premium synthwave trading terminal.

## Out of scope
- Real order execution / brokerage (read-only world).
- User accounts / server-side persistence (localStorage only).
- Charting library beyond inline sparklines.
- Mobile-first layout (desktop terminal is the target; stays usable narrow).
