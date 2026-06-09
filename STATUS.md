# STATUS — NEON SCREENER

**Build complete. 52 / 52 features passing.** A real, live market screener with a quant analytics
layer, in the synthwave aesthetic. Built with the orchestrator pattern: 7 waves, 11 parallel
subagents, verified live in-browser between every wave.

## What shipped

A single-page screener served by FastAPI, powered by `tradingview-screener` with live no-auth data
across 6 markets. The differentiator is the analytics layer on top of the raw scan.

### Backend (FastAPI)
- Service wrapper over `tradingview-screener` using the per-market helper functions so stocks,
  crypto, forex, futures, bonds, and CFDs all return live rows.
- 172-field curated catalog, grouped and typed. 22 preset scans + 5 factor presets.
- Sandboxed AST expression engine for computed columns (no `eval`, rejects `__`, attribute access,
  subscripts, and anything off the whitelist).
- In-result stats (zscore, pctrank, rank, norm) and a direction-aware weighted z-score factor model.
- In-memory TTL cache. Structured JSON errors, never a 500 stacktrace.
- 23 pytest tests passing (analytics math offline + a live API smoke).

### Frontend (vanilla JS, no build)
- Synthwave terminal shell: dark `#0a0a0c`, neon cyan/pink/green/purple, glassmorphism, JetBrains
  Mono for data, Inter for UI, glow on interactives.
- Visual filter builder (full operator set, AND/OR), market switcher, 172-field column picker,
  computed + stat column builders, interactive factor weight builder.
- Data table with multi-key sort, per-column client filters, summary-stat footer, heatmap and
  sign conditional formatting.
- Preset scan library, saved screens + watchlist (localStorage), CSV export, row detail drawer
  with performance sparkline, auto-refresh, command palette (Ctrl-K), keyboard navigation.

## Wave log

- **Wave 0** Scaffold: spec, 46-assertion feature list, deps.
- **Wave 1** Backend foundation (serial). Fixed: switched to per-market helpers so all 6 markets
  return live rows (set_markets returned 0 for crypto/forex).
- **Wave 2** Frontend shell + live table (serial). Established the state store and module contract.
- **Wave 3** Parallel x3: filter builder, presets + markets, column picker. Fixed: a market switch
  now clears filters/factor/computed/stats so carried-over conditions cannot empty the new market.
- **Wave 4** Parallel x4: table powers (sort/filter/footer/heatmap), factor builder + saved/watchlist/
  CSV, detail drawer + sparkline + auto-refresh, command palette + keyboard nav. Fixed: command
  palette now toggles the host `.open` class to match the layout visibility contract.
- **Wave 5** Polish: removed every em dash from source, reduced backdrop-blur radii for snappier
  paint, verified loading/empty/error states.
- **Wave 6** Final verify, README with fresh screenshots, this status doc.
- **Wave 7** Signals pack (parallel x3, probe-gated): SIGNALS preset group (golden/death cross,
  Stacked EMA Fibonacci ribbon on real 8/21/34/55/89, gap and go, breakouts, above/below all MAs),
  multi-timeframe columns (1D/1W/1M/1H/4H side by side), drag-and-drop column reorder. Fixed the
  heatmap color ramp (was near-invisible mid-range, now a visible pink-to-green gradient on every
  cell). Probed every MA period and timeframe suffix against live data first, then added the full
  EMA/SMA period set to the catalog (190 fields) so ribbon columns display, not just filter.

## Verified live (in-browser, real data)
- Default scan: 7,842 US stocks, NVDA first, sub-3s.
- Computed `(high-low)/close*100` = 5.87 on NVDA, `zscore(change)` and `pctrank(volume)` correct,
  all rendered as table columns.
- Factor model ranks by `factor_score` desc. Filter builder narrowed mega-caps 7845 to 712.
- Market switch to crypto (40,898) and forex (6,319) live. Multi-key sort, client filter (120 to 0
  on an extreme min), heatmap paint, sign coloring, detail drawer + sparkline, command palette
  ("crypto" to Enter switches market), keyboard row select, saved-screen round-trip, CSV blob
  (16 KB), watchlist persistence: all confirmed.

## Run

```bash
pip install -r requirements.txt
python run.py        # http://127.0.0.1:8000/
python -m pytest tests/ -q
```

## Known notes
- Crypto/forex/bond/cfd scans are huge (tens of thousands of rows). The default limit is 150; raise
  it in state if you want deeper pulls.
- Headless screenshots use `docs/capture.py` (Playwright). The Claude-in-Chrome CDP capture path
  times out on this machine for backgrounded tabs, so the standalone capture is the supported route.
- Real-time data needs TradingView cookies passed to `get_scanner_data`. Delayed data needs nothing.
