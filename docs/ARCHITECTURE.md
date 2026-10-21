# Architecture

How a screen flows through the system, and where the "not a clone" analytics
live. See `AGENTS.md` for the rules and `docs/MCP.md` for the MCP surface.

## The shape

```
                 +-------------------+
   HTTP  ----->  |  scanline/app.py   |  (TTL cache, JSON shaping)
                 +---------+---------+
                           |
   MCP   ----->  +---------v-------------------+
 mcp_server.py   |  scanline/pipeline.py        |   run_screen(ScreenRequest)
                 |   1. build query columns    |
                 |   2. screener.run_query --------> tradingview-screener -> TradingView scanner
                 |   3. analytics over rows    |
                 |   4. shape + order columns  |
                 +---------+-------------------+
                           |
                 +---------v---------+
                 | scanline/analytics |  computed columns, stats, factor model
                 +-------------------+
```

The key idea: **one pipeline, two front doors.** Both the HTTP endpoint
(`app.py`) and the MCP `screen` tool (`mcp_server.py`) call
`pipeline.run_screen`, so a screen produces identical results no matter who
drives it. `app.py` adds only an HTTP-level TTL cache around it; the MCP server
adds its own small cache. Neither reimplements the pipeline.

## A screen, step by step

1. **Request.** A `ScreenRequest` (`scanline/models.py`): market, filters,
   columns, match (all/any), computed columns, stats, factor weights, sort,
   limit, offset.
2. **Column planning** (`pipeline._query_columns`). The query needs not just the
   requested columns but any base fields the stats, factor, and sort steps will
   read. Those are unioned in so a `zscore(change)` stat or a factor on
   `Perf.1M` has its source column present.
3. **Query** (`screener.run_query`). Builds a `tradingview_screener.Query` scoped
   to the market via the per-market helper (stocks/crypto/forex/...), translates
   each `{field, op, value}` into a column condition (`_apply_op`), applies the
   server-side sort and the offset/limit, and runs it. Every upstream call is
   wrapped so a failure becomes a clean `ScreenerError`, never a 500 stacktrace.
4. **Analytics** (`scanline/analytics.py`), over the returned rows:
   - **Computed columns:** a sandboxed AST evaluator (`safe_eval`). Operators
     `+ - * / % **` and functions `abs min max round sqrt log ln floor ceil`.
     It rejects attribute access, subscripts, names with `__`, strings, and any
     call to a non-whitelisted function. A bad expression yields `None`, not an
     exception.
   - **Stats:** `zscore`, `pctrank`, `rank`, `norm`, each computed across the
     returned set (not the whole universe), emitted as a `fn(field)` column.
   - **Factor:** a direction-aware weighted z-score blend. Each field is
     z-scored across the rows, negated when `dir == "low"`, scaled by weight, and
     summed into `factor_score`. Missing values contribute zero.
5. **Shape.** Floats are rounded and NaN/inf become null. The column order is
   query columns, then computed, then stats, then `factor_score`.

## Fields

`scanline/fields.py` holds a curated, grouped, typed catalog (~190 friendly
fields) layered over the full TradingView field universe (1000+), loaded from
`fields_all.json` (generated offline by `gen_fields.py`, no runtime network
call). `validate_field` accepts any catalog field and any catalog field carrying
a known timeframe suffix (`RSI|1W`, `close|240`). This is why timeframe-suffixed
columns work everywhere, including the MCP `analyze` tool's multi-timeframe read.

## The MCP layer

`scanline/mcp_server.py` wraps the same engine. Discovery and screening tools call
`run_screen`; the symbol-intelligence tools (`analyze`, `technical_rating`,
`chart`, ...) resolve a row via `_resolve_row` and compose TradingView's own
fields into structured reads. The `analyze` tool pulls RSI and MACD on every
timeframe in one query and reports alignment. See `docs/MCP.md`.

## Frontend

Vanilla ES modules, no build step. Each feature module calls
`window.Screener.registerModule(name, ctx => {...})` and receives a context with
the store, the API client, and an element accessor. State lives in a small store
(`frontend/js/state.js`); formatting in `frontend/js/format.js`; the look is
entirely driven by the tokens in `frontend/css/theme.css`. A market switch resets
filters/factor/computed/stats so carried-over conditions cannot empty a new
market.

## Caching and resilience

A small in-memory TTL cache (`scanline/cache.py`) keyed by a hash of the request
sits in front of the engine in both front doors. It also softens TradingView's
rate-limit behavior under bursty agent use. The MCP `server_stats` tool reports
the cache hit rate and error count. The cache holds at most 256 entries (oldest
evicted first), expired entries are swept on every write, and the key includes
the data mode (`delayed`, `realtime`, `cookie_rejected`) but never a cookie.

## Validation and errors

`run_screen` validates before it queries: filter, column, sort, stat and factor
fields against the catalog (`validate_field`), operators, and filter values
(numbers, a real field id for cross-field compares, or text for text fields).
Nothing is silently dropped. `match`, sort `dir`, stat `fn` and factor `dir` are
`Literal` types, and `limit` is 1..1000 on the request model and every MCP tool.

Every failure keeps one JSON shape: the normal screen body with
`meta.error` (short human string), `meta.error_code` (stable machine string) and
`meta.detail`. `POST /api/screen` also sets the status: 400 for bad requests
(`unknown_field`, `unknown_sort_field`, `bad_value`, `bad_operator`,
`unknown_market`, `invalid_request`), 502 for upstream failures
(`upstream_unreachable`, `upstream_timeout`, `upstream_rate_limited`,
`upstream_error`). Raw library text never reaches a response.

A factor score is withheld (`null`, plus `meta.warnings`) when the weighted
columns are under 20% populated, as happens for growth, value and quality
factors on crypto and forex.

## CORS and real-time mode

CORS defaults to loopback origins only. `SCANLINE_CORS_ORIGINS` (a comma list,
or `*`) overrides it. `/api/health` answers GET and HEAD and reports `mode`.

An optional TradingView session cookie turns on real-time data; see
[REALTIME.md](REALTIME.md). `scanline/realtime.py` owns the credential and
`scanline/screener.py` is the only consumer of the raw value.
