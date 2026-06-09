# NEON SCREENER

The most complete market screener of all time. A **quant analytics layer** on top of
TradingView's data, not a TradingView clone. Built in the synthwave / TraderDaddy /
Bloomberg-terminal aesthetic.

Powered by [`tradingview-screener`](https://github.com/shner-elmo/TradingView-Screener) for live,
no-auth delayed data across stocks, crypto, forex, futures, bonds, and CFDs. Filtering is table
stakes. The point of this build is everything you do to the data *after* it lands: computed
columns, factor scoring, in-result statistics, multi-key sort, client-side analytics.

![Neon Screener](docs/hero.png)

## What makes it more than a clone

- **Computed columns.** Define your own derived fields with a safe expression engine, e.g.
  `(high-low)/close*100`, `close/sma50`, `volume*close`. Evaluated server-side with a sandboxed
  AST walker, no `eval`, no attribute access, no escapes.
- **In-result statistics.** Drop `zscore(field)`, `pctrank(field)`, `rank(field)`, or `norm(field)`
  columns that compute across the returned set, not the whole universe.
- **Composite factor scoring.** Assign weights and a direction (high or low is better) to any set
  of fields. The backend builds a direction-aware weighted z-score blend, returns a `factor_score`
  column, and ranks by it. Ships with Momentum, Value, Quality, Growth, and Low-Vol presets.
- **Multi-key sort.** Click to sort, shift-click to add secondary and tertiary keys with priority
  badges. Stable and numeric-aware, client-side.
- **Client-side filtering.** Per-column contains-filters and numeric min/max ranges that narrow the
  result instantly, no round-trip.
- **Summary-stat footer.** Count, mean, median, min, max, stdev, and sum per numeric column,
  recomputed on the visible (filtered) set.
- **Conditional formatting.** Per-column heatmap gradient (neon pink low, green high) plus
  sign-coloring for change and performance fields.

![Analytics layer](docs/analytics.png)

*Computed `dollar_vol`, a `zscore(change)` stat column, and a `factor_score` ranking, all live.*

## Signals, timeframes, drag-and-drop

![Signals and timeframes](docs/signals.png)

- **Signal presets.** Grouped one-click technical scans across SIGNALS, MOMENTUM, TREND, and
  MULTI-TIMEFRAME. Golden / Death Cross, Above / Below All MAs, Gap and Go, Volume Breakout, the
  **Stacked EMA Ribbon** on the real Fibonacci periods `close > EMA8 > EMA21 > EMA34 > EMA55 > EMA89`,
  plus MACD bull/bear cross, Stochastic and Stoch RSI crosses, RSI-reclaims-50, Awesome Oscillator
  zero cross, CCI reversal, VWAP reclaim, EMA 8/21 flip, ADX strong-trend, Parabolic SAR, Williams
  %R, and TradingView's own Strong Buy rating. No faked periods, every field is an actual scanner field.
- **Multi-timeframe signals.** The kind that only became possible once the field universe was
  confirmed: Triple Screen Bull / Bear (RSI aligned above or below 50 on daily, weekly, and monthly
  at once) and MACD aligned bullish on both daily and weekly.
- **Multi-timeframe columns.** Toggle 1D / 1W / 1M / 1H / 4H and any technical column gets its
  suffixed siblings added alongside, so you can read `RSI`, `RSI|1W`, and `RSI|1M` side by side.
  Fundamentals are never suffixed.
- **Drag-and-drop columns.** Reorder by dragging table headers or column-picker chips. A plain
  header click still sorts.

## The rest of the surface

- Visual filter builder with the full operator set: comparisons, `between`, `isin`, `crosses`,
  `above_pct`, `like`, and more, with AND / OR grouping.
- Multi-market switcher: US stocks, crypto, forex, futures, bonds, CFDs. A market switch is a fresh
  canvas.
- 47 one-click preset scans (top gainers, unusual volume, RSI extremes, 52-week highs, the signal
  pack above, dividend aristocrats, crypto movers, and more).
- Column picker over the full TradingView field universe: ~190 curated, friendly-labelled
  fields lead, and every other queryable field (1000+ in total, probed live so none of them
  error) is reachable by search. A Columns button by the table opens it.
- Row detail drawer with a performance sparkline. Saved screens and a watchlist (localStorage).
  CSV export. Auto-refresh. Command palette (Ctrl-K) and full keyboard navigation.

## Stack

- **Backend:** FastAPI + uvicorn, a thin wrapper over `tradingview-screener` with an in-memory TTL
  cache and a sandboxed analytics engine.
- **Frontend:** Vanilla JS ES modules and hand-rolled synthwave CSS. No build step.

## Run it

```bash
pip install -r requirements.txt
python run.py
```

Then open http://127.0.0.1:8000/. Data is live and delayed, no account needed. For real-time data
pass TradingView cookies through to `get_scanner_data`.

## Layout

```
backend/      FastAPI app, screener service, analytics engine, field catalog, presets, cache
frontend/     index.html, css/, js/ feature modules (filters, columns, presets, factor, table, ...)
docs/         screenshots + capture.py (headless Playwright screenshotter)
run.py        launches uvicorn on 127.0.0.1:8000
tests/        pytest: analytics math + a live API smoke
```

## Tests

```bash
python -m pytest tests/ -q
```

## Notes

- Read-only by design. No order execution, no money movement.
- `tradingview-screener` exposes 3000+ fields. The catalog curates 172 of the most useful ones,
  grouped and typed; computed columns reach anything you can express from them.
