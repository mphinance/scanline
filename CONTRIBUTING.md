# Contributing

Thanks for poking at SCANLINE. This is a focused project with a few firm
rules; read `AGENTS.md` first, it is the canonical guide. The short version is
below.

## Setup

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python run.py        # web app at http://127.0.0.1:8000/
python run_mcp.py    # MCP server over stdio
```

## Tests

```bash
python -m pytest tests/ -q -m "not live"   # offline (fast, no network): run this before every commit
python -m pytest tests/ -q                  # include live tests (hits TradingView)
node --test frontend/js/*.test.mjs
```

CI runs the offline suite, the frontend tests, and the mechanical house-rule
checks on every push and pull request (`.github/workflows/ci.yml`). Keep it green.

The live tests run on a daily schedule instead (`.github/workflows/live.yml`),
because they hit TradingView and an outage should never red a pull request. They
are also the only tests that can catch a field that is real but null in a given
market, so run them yourself before changing a preset, a factor model, or a
default column set.

## House rules (non-negotiable)

- **No em dashes.** Anywhere. Code, comments, UI copy, docs, commits.
- **TradingView only.** No other data source or destination.
- **Read-only.** No order execution, ever.
- **No frontend build step.** Vanilla ES modules and hand-rolled CSS only.
- **Real field ids only.** Probe a field against live data before adding it; the
  preset tests reject unknown fields.

## How to add things

### A preset scan
Add a dict to `PRESETS` in `backend/presets.py`. Use real field ids and the op
strings from `backend/screener._apply_op`. Give it `id`, `name`, `description`,
`market`, `columns`, `filters`, `match`, `sort`, and an optional `group`. The
tests in `tests/test_backend.py` validate every column and filter field.

### A catalog field
Add an `_f(id, label, group, type, unit)` entry in the right group in
`backend/fields.py`. Confirm it returns data live first. Types are one of
`num, pct, price, int, str, bignum`.

### An MCP tool
Add a `@mcp.tool` function in `backend/mcp_server.py`. Build a `ScreenRequest`
and call `_run` for a screen-shaped tool, or resolve a row with `_resolve_row`
and compose the helpers for a symbol-intelligence tool. Add a test in
`tests/test_mcp.py` (offline for wiring and pure helpers, `@pytest.mark.live`
for tools that fetch data). Update the count in `docs/MCP.md`.

### A frontend feature
Create a module in `frontend/js/` that calls
`window.Screener.registerModule(name, ctx => {...})`, add its `<script type="module">`
to `frontend/index.html`, and style it with the tokens in `frontend/css/theme.css`.
Pure logic (no DOM) should be exported so it can be tested with `node --test`.

### A showcase widget
Add a card to `showcase/index.html` using the official TradingView embed script.
Keep it on-theme with `showcase/styles.css`. Verify the embed URL resolves.

## Commits and waves

Work ships in numbered "waves"; `STATUS.md` is the running log, update it.
Commit messages are imperative and em-dash-free. If you are an AI agent, end the
message with the appropriate Co-Authored-By trailer.
