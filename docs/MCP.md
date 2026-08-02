# MCP reference

The SCANLINE MCP server (`backend/mcp_server.py`) exposes the live screen
engine over the Model Context Protocol so any MCP client can screen, score,
rank, and read charts. Built on `fastmcp`. Pure TradingView data, no account
needed (data is live and delayed).

## Run

```bash
pip install .                  # puts `scanline-mcp` on your PATH

scanline-mcp                   # stdio (Claude Desktop, Claude Code)
scanline-mcp --http 8765       # streamable-http for remote / multi-client
```

From a checkout without installing, `python run_mcp.py` takes the same flags.

## Register

Claude Desktop (`claude_desktop_config.json`) or a project `.mcp.json` for
Claude Code. With the package installed there are no paths to get wrong:

```json
{
  "mcpServers": {
    "scanline": { "command": "scanline-mcp" }
  }
}
```

Claude Code can write that for you:

```bash
claude mcp add scanline -- scanline-mcp
```

Running from a checkout instead, use absolute paths and the venv interpreter:

```json
{
  "mcpServers": {
    "scanline": {
      "command": "/abs/path/.venv/bin/python",
      "args": ["/abs/path/run_mcp.py"]
    }
  }
}
```

Then ask in plain language, for example: "Screen US mega caps with RSI under 35,
add a dollar-volume column, and rank them by my Value factor," or "Read NVDA
across timeframes and chart it."

## Tools (27)

Every tool also carries a full docstring, which is what an MCP client actually
reads when choosing between them. The market-study tools below carry the most
detailed ones.

### Screening

- **`screen(market, filters, columns, match, sort, computed, stats, factor, limit, offset)`**
  The full engine. `filters` is a list of `{field, op, value}`; `value` may be a
  number, a list, or another field id (cross-field, so
  `{"field":"SMA50","op":"crosses_above","value":"SMA200"}` is a golden cross).
  `computed` adds derived columns from a sandboxed expression engine, `stats`
  adds `zscore`/`pctrank`/`rank`/`norm` across the result, `factor` is a weighted
  direction-aware composite score. Returns `{count, returned, market, ms,
  columns, rows, table}`.
- **`run_preset(preset_id, limit, include_otc)`** Run one of the 47 named preset
  scans. The 25 signal/momentum/trend/MTF presets exclude OTC by default, because
  an indicator reading on a sub-penny shell is computed from noise: those rows
  carry "changes" like +9,900 percent, which is a $0.0001 tick expressed as a
  percentage. It is a data quality filter only, with NO market cap or share price
  floor, so genuine small and cheap listed names still come back. When the guard
  is on, the response carries an `otc_guard` block reporting how many rows it
  removed, so nothing is dropped silently. Pass `include_otc=True` to lift it.
- **`run_factor_preset(factor_preset_id, market, filters, columns, limit)`** Rank
  a market by a named factor (Momentum, Value, Quality, Growth, Low-Vol).
- **`lookup_symbol(ticker, market, columns)`** One row by exact ticker.

### Discovery

- **`list_markets()`** The six markets (america, crypto, forex, futures, bond, cfd).
- **`search_fields(query, group, limit)`** Search the 1000+ field universe.
- **`list_operators()`** The filter operators and what value each expects.
- **`list_presets(group)`** The preset scans, optionally by group.
- **`list_factor_presets()`** The composite factor presets.
- **`server_stats()`** Server health: calls served, cache hit rate, errors.

### Symbol intelligence

- **`analyze(ticker, market)`** Read a symbol's chart into structured technical
  analysis: trend, momentum, range, rating, and plain-language signals. It is
  **multi-timeframe in one call**, RSI and MACD bias on the 1h, 4h, 1d, 1w, and
  1m at once with an alignment verdict, so nobody has to swap timeframes.
- **`technical_rating(ticker, market, timeframes)`** TradingView's own gauge
  (overall, moving averages, oscillators) as Strong Buy ... Strong Sell, across
  the timeframes you ask for.
- **`compare(tickers, columns, market)`** Several symbols side by side.
- **`search_symbols(query, market, limit)`** Resolve "apple" or "nvda" to rows.
- **`chart(ticker, market, interval, theme)`** A live TradingView chart deep link
  plus a ready-to-embed Advanced Chart widget config.
- **`sector_breakdown(market, filters, limit)`** Aggregate a screen by sector:
  count, average change, total market cap.

### Market studies

Each of these runs one broad screen and reduces it to a structured read, rather
than handing back rows. All take an optional `filters` list you can narrow with,
and all take `include_otc` (see below).

- **`top_movers(market, n, filters, columns, include_otc)`** The top N gainers and
  top N losers in one call.
- **`volume_leaders(market, min_rvol, filters, limit, top, include_otc)`** Names
  trading on unusual volume right now, classified by price direction.
- **`new_highs_lows(market, filters, threshold, limit, include_otc)`** Stocks at or
  near their 52 week highs and lows. A classic breadth gauge.
- **`market_breadth(market, filters, limit, include_otc)`** Advancers and
  decliners, percent above key moving averages, and the RSI distribution.
- **`sector_rotation(market, filters, limit, include_otc)`** Sectors ranked by
  multi-timeframe momentum. A rotation dashboard.
- **`momentum_consistency(market, direction, min_aligned, filters, limit, top, include_otc)`**
  Ranks names by how consistently returns align across five timeframes.
- **`relative_strength_leaders(market, filters, limit, top, include_otc)`** Names
  outperforming their own sector peers, not just the index.
- **`ema_stack_scan(market, min_stack, filters, limit, top, include_otc)`** Ranks by
  EMA and SMA stack alignment. A bull-stack breadth indicator.
- **`gap_scanner(market, min_gap_pct, filters, limit, top, include_otc)`** Names
  that gapped at the open, with intraday fill progress tracked. Samples both
  tails, so gap downs come back as well as gap ups.
- **`earnings_radar(market, horizon, filters, limit, top, include_otc)`** Names
  reporting earnings within the next N days. Company earnings only. This is NOT an
  economic calendar and carries no macro releases.
- **`dividend_screen(market, min_yield, min_years_growing, filters, limit, top, include_otc)`**
  Dividend payers ranked by a composite Dividend Quality Score.

### The OTC guard

On `market="america"` every tool above, plus `run_preset` and
`run_factor_preset`, excludes OTC by default.

It is a data quality filter, not a view on company size. A sub-penny shell that
ticks one hundredth of a cent posts a four figure percentage move, so anything
ranking on change or gap returns those rows and only those rows. Measured
unguarded, `top_movers` came back 10 of 10 OTC on both its gainers and its
losers, and `gap_scanner` 50 of 50 on both sides. The top gain was +334900%,
which is a $0.0001 tick rendered as a percentage.

There is **no market cap and no share price floor**, so a $2 NASDAQ small cap is
still a legitimate result and still comes back. It is a single
`exchange not_in ["OTC"]`, deliberately not an allow list of the other venues,
which would silently drop one TradingView adds later. There are five today:
OTC, NYSE, NASDAQ, AMEX and CBOE.

Nothing is dropped silently: the response carries an `otc_guard` block saying
whether the guard was active. Pass `include_otc=True` to lift it per call. The
guard also stands aside entirely if you supply your own `exchange` filter, and
never applies off `america`, where the venue names are meaningless.

`screen` is deliberately **not** guarded. It is the raw escape hatch, its filters
are entirely yours, and it accepts `match="any"`, where an appended condition
would widen the result rather than restrict it.

## Prompts (4)

Canned workflows the client can launch:

- **`momentum_breakouts(market)`** Find and read the strongest breakouts now.
- **`oversold_quality(market)`** Oversold names that are still high quality.
- **`rank_by_factor(factor, market)`** Rank a market by a factor and read the leaders.
- **`read_symbol(ticker)`** A full plain-language chart read for one symbol.

## Resources (3)

- **`screener://fields`** The full field catalog.
- **`screener://presets`** Every preset and factor preset.
- **`screener://operators`** The operator reference.

## Notes

- A short TTL cache sits in front of the engine to soften TradingView's
  rate-limit behavior under bursty agent use. `server_stats` reports the hit rate.
- The MCP server imports the backend modules directly, so it works without the
  web app running, and a screen behaves identically to the HTTP API (both call
  `backend.pipeline.run_screen`).
- Tests: `tests/test_mcp.py`. Offline tests cover wiring and the pure helpers;
  `@pytest.mark.live` tests exercise the real data tools.
