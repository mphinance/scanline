# STATUS - SCANLINE

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

- **Nightly 2026-06-20** Added `winsor` Winsorized normalization stat to the analytics layer. The
  new `fn="winsor"` stat clips column values at the 5th/95th percentile then normalizes to [0, 1].
  Unlike plain `norm`, a single outlier cannot compress all other scores toward the middle of the
  range -- the clipping absorbs the tail while every row remains in the result. Ideal for building
  factor scores from raw screener columns (market cap, volume, PE) where extreme values are common.
  New helper: `_quantile(sorted, q)` with linear interpolation. Five new offline tests cover outlier
  clamping, agreement with `norm` on inner ranges, None passthrough, constant series, and the
  single-value edge case. PR #2, merged green.

- **Nightly 2026-06-19** Added `madzscore` robust z-score stat to the analytics layer. The new
  `fn="madzscore"` stat uses median and MAD (scaled by 1.4826) instead of mean and std, making
  factor ranking far more stable when result sets contain extreme outliers (volume spikes, mega-cap
  vs small-cap market caps). Four new offline tests cover symmetric data, outlier resistance, None
  handling, and the constant-series edge case. PR #1, merged green.

- **Wave 15** Renamed the GitHub repo as well (`mphinance/screener` to `mphinance/scanline`, done in
  the GitHub UI). Rewrote every repo hyperlink (CI badge, live-demo badge, Pages URL, OG tags,
  footer, GitHub links) to the new path and updated the git remote. The live site is now at
  mphinance.github.io/scanline.
- **Wave 14** Renamed the project to SCANLINE (was NEON SCREENER) across all code, docs, UI copy,
  and the MCP server name, in one pass. Renamed `pine/neon_ai_read.pine` to
  `pine/scanline_ai_read.pine`. Fixed a stray em dash in this file. Full suite green after the rename.
- **Wave 13** CI + social + docs. GitHub Actions CI runs the offline suite on every push (green
  badge). Social preview (OG / Twitter meta, favicon, 1200x630 og.png). Full documentation set:
  AGENTS.md, CLAUDE.md, ACKNOWLEDGMENTS.md, CONTRIBUTING.md, docs/ARCHITECTURE.md, docs/MCP.md.
- **Wave 12** GitHub Pages showcase (`showcase/`): a static, pure-TradingView site, a live widget
  gallery plus a Lightweight Charts panel, deployed to Pages via Actions. Live and serving at
  mphinance.github.io/scanline. The client-side half to the run-at-home app.

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
- **Wave 11** MCP symbol intelligence + multi-timeframe. Six new tools (`search_symbols`,
  `compare`, `technical_rating`, `analyze`, `chart`, `sector_breakdown`) and four MCP prompts
  (`momentum_breakouts`, `oversold_quality`, `rank_by_factor`, `read_symbol`), so 16 tools total.
  The centerpiece is `analyze`: it reads a symbol's chart into structured trend / momentum / range
  / rating / signals, and it is multi-timeframe in one call, RSI and MACD bias on the 1h / 4h / 1d
  / 1w / 1m with an alignment verdict (verified live: TSLA "fully aligned bearish," NVDA and AAPL
  the short-weak / long-strong split). `chart` returns a live TradingView deep link plus a
  ready-to-embed Advanced Chart widget config. Everything pure TradingView. `pine/scanline_ai_read.pine`
  is the on-chart twin: a v6 indicator that prints a machine-parseable read for an AI to consume off
  a screenshot, same signal vocabulary as `analyze`. 9 new tests (offline helpers + live data tools).

- **Wave 10** MCP server. Exposed the live screen engine over the Model Context Protocol with
  `fastmcp`. Factored the screen pipeline out of `app.py` into `backend/pipeline.py` so the HTTP
  API and MCP server run byte-identical logic (no behavior change, full suite still green). Ten
  tools (`screen`, `run_preset`, `run_factor_preset`, `search_fields`, `list_operators`,
  `list_presets`, `list_factor_presets`, `list_markets`, `lookup_symbol`, `server_stats`), three
  resources (fields, presets, operators), a TTL cache and a self-stats tool for resilience under
  bursty agent use. Cross-field filters (golden cross etc.) work through the tool unchanged.
  Verified live in-memory: mega-cap RSI screen with a computed column, z-score, and factor rank
  all returned real rows. 12 new tests (10 offline wiring + error paths, 2 live). README now has a
  "versus the TradingView web screener" section. Research agent surveyed four existing TradingView
  MCP servers (all MIT) to shape the tool set; charts and a Pine-script converter are queued next.

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
