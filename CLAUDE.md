# CLAUDE.md

Project guidance for Claude Code. The full guide lives in **[AGENTS.md](AGENTS.md)**;
this file is the quick entry point plus the rules worth repeating.

## The project in one line

A live market screener (FastAPI + vanilla JS over `tradingview-screener`) with a
quant analytics layer and an MCP server, plus a static TradingView widget
showcase for GitHub Pages. "TradingView, AI'ed."

## Commands

```bash
python run.py                               # web app at http://127.0.0.1:8000/
python run_mcp.py                           # MCP server (stdio; --http 8765 for http)
docker compose up                           # same web app, containerized
pip install .                               # installs `scanline` and `scanline-mcp`
python -m pytest tests/ -q -m "not live"    # offline test suite (fast, no network)
python -m pytest tests/ -q                  # include live tests (hits TradingView)
node --test frontend/js/*.test.mjs          # frontend logic tests
```

## Rules that matter most

- **No em dashes.** Anywhere. Code, comments, UI, docs, commits. Use periods and commas.
- **TradingView only.** No outside data sources or destinations, ever.
- **Read-only.** No order execution.
- **No frontend build step.** Vanilla ES modules, hand-rolled CSS, theme tokens in
  `frontend/css/theme.css`.
- **Real field ids only.** Validated against the live field universe; tests enforce it.

## Where things are

- Screen engine: `backend/pipeline.py` (shared by the HTTP API and the MCP server).
- Analytics (sandboxed expressions, stats, factor model): `backend/analytics.py`.
- Field catalog: `backend/fields.py`. Presets: `backend/presets.py`.
- MCP server (27 tools, 4 prompts, 3 resources): `backend/mcp_server.py`. Reference: `docs/MCP.md`.
- Frontend feature modules: `frontend/js/` (register via `window.Screener.registerModule`).
- Static showcase (Pages): `showcase/`.
- Packaging: `pyproject.toml` (entry points), `Dockerfile`, `docker-compose.yml`.
  Dependencies live in both `requirements.txt` and `pyproject.toml`; change both.
- Deeper docs: `docs/ARCHITECTURE.md`, `docs/MCP.md`, `CONTRIBUTING.md`.

## Workflow

Work ships in numbered "waves"; `STATUS.md` is the running log, keep it current.
Commit messages are imperative, em-dash-free, and end with the Co-Authored-By trailer.
When changing the screen pipeline, run the offline suite; it covers the analytics
math and the MCP wiring without needing the network.
