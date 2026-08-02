# AGENTS.md

Guidance for AI agents and human contributors working in this repo. This is the
canonical project guide. `CLAUDE.md` points here.

## What this is

SCANLINE is a live, real-data market screener with a quant analytics layer,
plus an MCP server so an AI agent can drive it. It is a showcase of what you can
build on TradingView: the screener app you run at home, a static widget showcase
for GitHub Pages, and an MCP layer that makes the whole thing AI-drivable.

Two halves:
- **The app** (`backend/` + `frontend/`): the full screener. FastAPI backend over
  the `tradingview-screener` package, vanilla-JS frontend, no build step.
- **The showcase** (`showcase/`): a static, no-backend site (TradingView widgets +
  Lightweight Charts) that deploys to GitHub Pages.

## Hard rules (do not break)

1. **No em dashes anywhere.** Not in code, comments, UI copy, docs, or commit
   messages. Use periods, commas, or "and". This is enforced across the repo.
2. **TradingView only.** No Tradier, Yahoo, Finviz, brokers, or any other data
   source or destination. Every byte of data and every handoff is TradingView.
   This is the whole point of the project.
3. **Read-only.** No order execution, no money movement, no brokerage. The
   "Open in TradingView" link is a navigation, not a trade.
4. **No build step on the frontend.** Vanilla ES modules, hand-rolled CSS. Do
   not add a bundler, framework, or transpiler.
5. **Every field id must be real.** Catalog and preset fields are validated
   against the live TradingView field universe. A typo that returns nothing is a
   bug. See `backend/fields.py` and the preset tests.

## Layout

```
backend/        FastAPI app + the screen engine
  app.py          HTTP routes, static mount, TTL cache wrapper
  pipeline.py     run_screen(): the shared screen pipeline (HTTP and MCP both call it)
  screener.py     thin wrapper over tradingview-screener (Query building, operators)
  analytics.py    sandboxed AST expression engine, stats (zscore/pctrank/rank/norm), factor model
  fields.py       the field catalog (curated + full universe), validation, defaults
  presets.py      47 preset scans + 5 factor presets
  models.py       pydantic request/response models
  cache.py        in-memory TTL cache
  mcp_server.py   the MCP server (fastmcp): 27 tools, 4 prompts, 3 resources
  cli.py          host/port resolution behind the `scanline` command and run.py
frontend/       vanilla JS, ES modules registering via window.Screener.registerModule
  css/theme.css   the synthwave design tokens (the source of truth for the look)
  js/             feature modules (filters, columns, presets, factor, table, detail, openin, ...)
showcase/       static GitHub Pages site (widget gallery + Lightweight Charts)
pine/           Pine Script meant for AI to read (scanline_ai_read.pine)
docs/           screenshots + capture scripts + ARCHITECTURE.md + MCP.md
tests/          pytest (analytics math, MCP wiring, live API smoke)
run.py          launches the web app on 127.0.0.1:8000
run_mcp.py      launches the MCP server (stdio, or --http PORT)
pyproject.toml  packaging + the `scanline` / `scanline-mcp` entry points
Dockerfile      slim image, non-root, healthchecked
docker-compose.yml  `docker compose up`, plus an opt-in `mcp` profile
```

## Run it

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python run.py        # web app at http://127.0.0.1:8000/
python run_mcp.py    # MCP server over stdio (--http 8765 for streamable-http)
```

Installed (`pip install .`) the same two are on PATH as `scanline` and
`scanline-mcp`, and `docker compose up` runs the web app in a container. The web
app resolves host and port from flags, then `SCANLINE_HOST` / `SCANLINE_PORT`,
then the loopback default. See `backend/cli.py`.

Keep `requirements.txt` and the `dependencies` list in `pyproject.toml` in step:
the checkout path installs from the first, `pip install .` resolves the second.

## Test it

```bash
python -m pytest tests/ -q -m "not live"   # offline: analytics + MCP wiring (fast, no network)
python -m pytest tests/ -q                  # add the live tests (hits TradingView)
node --test frontend/js/*.test.mjs           # frontend logic
```

CI (`.github/workflows/ci.yml`) runs the offline suite plus the frontend tests on
every push and pull request, and enforces the house rules that are mechanical
(no em dashes, no byte order marks). Live tests are skipped there on purpose so
an upstream outage never reds a pull request.

`.github/workflows/live.yml` runs the full suite including the live tests daily.
That job is the only thing that can catch a dead field: `validate_field` is
global, so a field can pass validation and still be null for every row in a
given market, which is how several scans and the Growth factor model ended up
returning nothing (or ranking on nothing) while reporting success.

## Architecture in one paragraph

A screen request (market, filters, columns, computed columns, stats, factor,
sort) flows through `pipeline.run_screen`: it builds the column set, runs the
query via `screener.run_query`, then applies the analytics layer (`analytics`)
over the returned rows. The HTTP endpoint and the MCP `screen` tool both call
`run_screen`, so a screen behaves identically no matter who drives it. See
`docs/ARCHITECTURE.md` for the full walk-through.

## The MCP server

`backend/mcp_server.py` exposes the same engine over the Model Context Protocol
with `fastmcp`. 27 tools (screening, symbol intelligence, market studies), 4 prompts, 3
resources. The centerpiece is `analyze`, a multi-timeframe chart read (RSI and
MACD bias on the 1h/4h/1d/1w/1m at once). Full reference and config in
`docs/MCP.md`.

Every tool that scans a broad `america` universe excludes OTC by default, via
`_otc_guard` in `backend/mcp_server.py` and `NO_OTC` in `backend/presets.py`.
It is a data quality filter with no market cap or price floor: sub-penny shells
post four figure percentage moves, so anything ranking on change or gap returns
those and nothing else. Lift it per call with `include_otc=True`. `screen` is
deliberately exempt, being the raw escape hatch. A test enforces that any new
broad america tool takes the parameter.

One thing to know before touching `backend/screener.py`: `Query.where()` and
`Query.where2()` in `tradingview-screener` ASSIGN their slot rather than append,
and the market helpers (`stocks('america')` and friends) ship the constraints
that define the market in exactly those slots. `run_query` composes with them on
purpose. Calling `.where(*conds)` directly drops `is_primary` and nearly doubles
the universe.

Register it (Claude Desktop `claude_desktop_config.json`, or a project
`.mcp.json` for Claude Code):

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

## How to extend (common tasks)

- **Add a preset scan:** append to `PRESETS` in `backend/presets.py` using real
  field ids and the op strings from `backend/screener._apply_op`. The preset
  tests will fail if any field is unknown.
- **Add a field to the catalog:** add a `_f(...)` entry in the right group in
  `backend/fields.py`. Probe it live first so it actually returns data.
- **Add an MCP tool:** add a `@mcp.tool` function in `backend/mcp_server.py` that
  builds a `ScreenRequest` and calls `_run`, or composes the helpers. Add a test
  in `tests/test_mcp.py` (offline for wiring, `@pytest.mark.live` for data).
- **Add a frontend feature:** a new ES module in `frontend/js/` that calls
  `window.Screener.registerModule(name, ctx => {...})`. Use `theme.css` tokens.

## Conventions

- Python: type hints, `from __future__ import annotations`, clean errors (never a
  raw 500 stacktrace; wrap upstream calls in `ScreenerError`).
- Frontend: one feature per module, register through `window.Screener`, style with
  the theme tokens, no inline magic numbers for color.
- Work ships in numbered "waves"; `STATUS.md` is the running log. Update it.
- Commit messages: imperative, no em dashes, end with the Co-Authored-By trailer.
