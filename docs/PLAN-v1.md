# Plan: Scanline v1.0 release

Goal: a stranger goes from the blog post to a working screener in under 60 seconds,
on their own machine, and nothing they click is broken.

Why local-first is the product, not a limitation: TradingView data is fetched from
the user's own IP, so this cannot live on a cloud host. The release story is
therefore "one command on your laptop", and the GitHub Pages showcase stays the
zero-install teaser that points at it.

Status of this plan: written from a live audit (backend and MCP hit against real
TradingView data, UI driven in a browser at four widths, wheel built and installed
into a clean venv). Items marked VERIFIED were reproduced. Nothing here has been
implemented yet.

## What the audit found

### Ship blockers (P0)

| # | Problem | Where | Fix |
|---|---------|-------|-----|
| 1 | Detail drawer never appears. `#drawer-host` is translated off-screen and nothing adds `.open`. Every row click does nothing visible. VERIFIED | `frontend/css/layout.css:282-300`, `frontend/js/detail.js:~340-357` | Toggle `.open` on the host, Escape and scrim close it. |
| 2 | Layout is broken under ~900px. Page scrolls horizontally (scrollWidth 1329 at 390px), the 280px rail leaves ~110px for the table, collapse button does nothing visible. VERIFIED | `layout.css`, `table.css` | Off-canvas rail with a hamburger below 900px, no page-level horizontal scroll. Load `responsive-craft` first. |
| 3 | `above_pct` / `below_pct` pass a list as a single arg. Breaks presets `high_52w`, `low_52w`, `breakouts`, the MCP `run_preset`, and the UI's "above by %" operator. All return 0 rows. VERIFIED | `scanline/screener.py:84-87` | Unpack the value. Add an offline test that builds every preset's filters so this class of bug cannot ship again. |
| 4 | `9**9**9**9` as a computed column pins a core and kills `/api/health`. Reachable from the HTTP API and the MCP `screen` tool. VERIFIED | `scanline/analytics.py:132-133` | Bound exponent and result size, cap expression length and AST depth, test it. |
| 5 | Dead field `dividend_yield_recent` (null on every US row). Already fixed on `master` by #22; this branch is behind it. | `presets.py`, `mcp_server.py` | Rebase onto master, then confirm `dividend_screen`, `dividend_aristocrats` and the Value factor preset return real rows. |

### Wrong, but not fatal (P1)

- **Silent empties.** Unknown filter field, non-numeric value, unknown column, unknown
  sort field, bad `match`/`dir`: all return HTTP 200 with zero rows and no error.
  Validate against the catalog, name the offending field, use `Literal` types in
  `models.py`.
- **Factor scores on nothing.** Growth/Value/Quality on crypto and forex rank 100 rows
  on all-null weight columns and report success. Refuse or warn when coverage is low.
- **Errors are unhelpful.** The API returns 200 with `meta.error` and leaks raw
  library text (`HTTPSConnectionPool(...)`). The UI then drops the server's `detail`,
  prints `LATENCY undefinedms`, and replaces the table with a bare "QUERY ERROR" and
  no retry. Map to proper 400/502, short human messages, a Retry button.
- **MCP rough edges.** `technical_rating` echoes a bad timeframe key but returns daily
  data; `compare` silently drops unknown tickers; `earnings_radar` surfaces a raw
  pydantic error.
- **First-run is a wall of 150 unlabeled rows.** No hint at what to do, Ctrl-K is only
  advertised inside the palette. Header says "NEON SCREENER", title and footer say
  "SCANLINE". Filter and Factor builders default to the field "Employees".
- **Keyboard users cannot open a row** (rows are `tabindex=-1`, no role). Focus rings
  are inconsistent.

### Polish (P2)

`limit` has no upper bound (100k returned 1.8 MB), both caches grow without limit,
CORS is `*` (matters the moment someone sets `SCANLINE_HOST=0.0.0.0`), `/favicon.ico`
404s, `HEAD /api/health` 404s, test files ship inside the wheel, 10-11px text and
~30% of controls under 32px touch size, 47 presets in one undifferentiated list,
the column stats panel eats ~200px by default, SAVED tab is styled like a disabled
control, static "no auth, delayed data" footer (open issue #20).

## Phases

Each phase is a branch and a PR, offline suite green before merge
(`python -m pytest tests/ -q -m "not live"` plus `node --test frontend/js/*.test.mjs`).
Hard rules from `AGENTS.md` still apply: no em dashes, TradingView only, read-only,
no frontend build step.

### Phase 0: ground clear (half a day)

1. Merge or close PR #21 (`fundamentals()` tool), rebase onto master so #22 lands.
2. Fix P0 #3 and #4 with tests. These are one-liners that currently ship broken or
   hangable.
3. Add the "every preset executes" test and a "every preset returns rows" case to the
   daily `live.yml` run. The current suite cannot see either failure.

### Phase 1: make the app not lie (1-2 days)

1. Request validation in `models.py` and `screener.py` (see P1 silent empties).
   Real HTTP statuses, structured `{code, message, field}` errors.
2. Factor coverage guard.
3. `limit` cap (1000), cache max size with sweep-on-set, CORS defaulting to the
   loopback origins unless `SCANLINE_CORS_ORIGINS` is set.
4. MCP fixes (`technical_rating`, `compare`, `earnings_radar`).
5. `GET`+`HEAD` health, favicon.

### Phase 2: UI that works and is obvious (3-4 days)

Order matters: the first two are pure bug fixes, the rest is UX.

1. Drawer fix.
2. Responsive pass: off-canvas rail, table scrolls inside its own container, tap
   targets 32px minimum, base text 12px minimum. Verify at 1440/1024/768/390.
3. Error and loading states: real messages, Retry, a boot indicator so first paint is
   not a black screen, fix `undefinedms`.
4. First-run: one dismissible strip ("Pick a preset, or press Ctrl-K"), a labeled
   default scan, unified SCANLINE branding, remove placeholder text from `index.html`.
5. Builders: default Filter and Factor to Price / Change %, group the field dropdown.
6. Presets: category chips and a search box (the palette and the list share one order
   today).
7. Table: stats panel collapsed by default, rows focusable with Enter to open,
   consistent focus ring.
8. Footer shows the real data mode instead of a static string (closes #20), plus a
   short "real-time data" doc linked from it.

### Phase 3: packaging and release (2 days)

Dependency on Phase 0 only; can run in parallel with Phase 2.

1. **Name.** `scanline` on PyPI is taken (an unrelated meshlab tool, 0.2.1). Publish as
   **`scanline-screener`** (checked: unclaimed), keep the commands `scanline` and
   `scanline-mcp`. Do this before the post goes out; names get squatted.
2. **Restructure to a real `scanline/` package.** STATUS.md already flags that the wheel
   installs top-level `backend/` and `scanline_frontend/`, which collides with any
   other distribution using those names. Move `scanline/` to `scanline/`, frontend to
   `scanline/static/`, drop test files from the wheel, keep `run.py`/`run_mcp.py` as
   shims. One mechanical PR, nothing else mixed in.
3. **Launch UX.** `scanline` opens the browser by default (`--no-browser` to skip),
   prints the URL and a one-line "data is delayed, no key needed" note, and fails with
   a clear message if the port is taken (try the next port).
4. **Release automation.** On tag `v*`: build sdist and wheel, publish via PyPI trusted
   publishing (no token stored), build and push a multi-arch image to GHCR, create a
   GitHub Release with generated notes and the wheel attached. Bump to 1.0.0, add a
   CHANGELOG.
5. **Install matrix in the README, in this order:**
   `uvx scanline-screener` (zero install) , `pipx install scanline-screener`,
   `docker run -p 127.0.0.1:8000:8000 ghcr.io/mphinance/scanline`, from source.
   Add the MCP one-liner: `claude mcp add scanline -- uvx --from scanline-screener scanline-mcp`.
6. **Smoke test in CI** on the built wheel: install into a clean venv on Linux, macOS
   and Windows, start the server, hit `/api/health` and `/`. This is what catches the
   packaging bugs the last two reviews found by hand.
7. Optional, only if the post gets traction: PyInstaller single-file binaries attached
   to the Release for people without Python. Skip for v1.

### Phase 4: the post (same day as release)

Fresh README top: one hero GIF, the 3-line install, "runs on your machine because
TradingView data comes from your IP". Re-record `docs/*.png` and `boot.gif` after
Phase 2, since the current screenshots predate the fixes. Showcase gets the same
install block (it already has a "Run it yourself" section). Update STATUS.md and
`CLAUDE.md` counts (tests, tools, presets) in the same change.

## Order and effort

Phase 0 and 1 first (backend, mostly mechanical, parallelizable). Phase 2 and 3 run
side by side. Roughly 7-9 working days serial, 4-5 with the phases split across
branches. If the post is today, the minimum credible cut is: Phase 0, the drawer fix,
the responsive pass, and the PyPI name plus a tagged GitHub Release. Everything else
can follow as 1.0.1.

## Real-time mode (decided: in for 1.0)

`tradingview-screener` forwards `**kwargs` to `requests`, so a TradingView session
cookie turns the delayed feed into the user's real entitlement. Design:

1. Cookie comes from `SCANLINE_TV_SESSIONID` (and optional `_sign`), or a paste box in
   a Settings drawer that writes to a `0600` file under the user config dir. Never
   logged, never echoed back by any endpoint, never sent anywhere except
   `scanner.tradingview.com`. Not stored in localStorage.
2. `/api/health` and the footer report the real mode: `delayed`, `realtime`, or
   `cookie rejected`. This closes #20.
3. Cache keys include the mode so delayed rows never serve a realtime request.
4. A short doc: how to copy the cookie, what it grants, how to revoke it (log out of
   TradingView), and the plain warning that it is a login credential for your account.
5. Tests: cookie is passed through to the query, absent from every response body and
   log line.

## Scope (decided: both)

Cut-down release today: Phase 0, drawer fix, responsive pass, tag and GitHub Release.
Then the full plan as 1.0.x. Real-time mode lands in Phase 2 alongside the footer fix.

## Decisions still open

1. PyPI name: `scanline-screener`? Nothing gets published until you confirm.
2. Restructure to `scanline/` before the first PyPI upload (recommended: once a
   wheel with top-level `scanline/` is on PyPI, renaming is a breaking change).

## Decisions needed from you (original list)

1. PyPI name: `scanline-screener` fine?
2. Restructure to `scanline/` before 1.0 (recommended, breaks nothing for users, costs
   a day) or ship 1.0 as-is and restructure in 1.1 (breaking for anyone importing
   `backend`)?
3. Is a hosted anything off the table, or do you want a "bring your own cookies" real-time
   mode documented for 1.0?
4. Cut-down release today, or the full plan?

## Not verified by the audit

Column picker UI, preset runs through the UI, saved-screen create/delete, auto-refresh,
Escape-to-close on the drawer (it is invisible), real TradingView rate limiting
(simulated only), non-US markets for most MCP tools, and the suspiciously low crypto
prices (BTC ~83k seen). Phase 2 starts with a pass over these.
