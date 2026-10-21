# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.0.0] - Unreleased

First public release. A stranger can go from nothing to a working screener with one command.

### Added

- One-file double-click binaries on every GitHub Release: `scanline-windows.exe`,
  `scanline-macos` and `scanline-linux`, built with PyInstaller and smoke-tested in CI. They
  serve the frontend and open the browser by default. On Windows the console stays open with the
  URL, and on a crash waits for Enter so the error can be read. `scanline mcp` runs the MCP
  server from the same file. Not code-signed: README covers the SmartScreen and macOS prompts.
- PyPI publishing is optional. The package is named `scanline-screener` and the commands stay
  `scanline` and `scanline-mcp` (`scanline-screener` aliases `scanline` for `uvx`). The release
  workflow only publishes when the repo variable `PUBLISH_PYPI` is `true`, so a tag works with
  no PyPI setup, and the GitHub Release does not wait on PyPI.
- `scanline` opens your browser once the server is up. `--no-browser` or
  `SCANLINE_NO_BROWSER` skips it. It never opens for a non-loopback bind, inside Docker, or under CI.
- If the default port is busy, `scanline` tries the next 10 and says so. An explicit `--port`
  or `SCANLINE_PORT` is never moved; a busy one is a clear error.
- Tag-driven release workflow: sdist and wheel, optional PyPI trusted publishing (no stored token), a
  multi-arch (amd64, arm64) image at `ghcr.io/mphinance/scanline`, and a GitHub Release.
- Wheel smoke test in CI on Linux (Python 3.10 and 3.12), macOS and Windows: install into a
  clean venv, start the server, probe `/api/health` and `/`.
- `pipx install git+https://github.com/mphinance/scanline` today; `uvx scanline-screener` and
  `pipx install scanline-screener` once PyPI is enabled. A one-line `claude mcp add` for the MCP server.
- Real-time mode: pass a TradingView session cookie (`SCANLINE_TV_SESSIONID`) to upgrade the
  delayed feed to your own entitlement. The cookie is never logged or echoed back. The footer
  and `/api/health` report the real data mode. See `docs/REALTIME.md`. *(in flight)*

### Changed

- The Python package is now `scanline` (was `backend`) and the frontend ships inside it as
  `scanline/static`. The old top-level `backend/` and `scanline_frontend/` names collided with
  other distributions. `run.py` and `run_mcp.py` remain as shims.
- Test files no longer ship in the wheel.
- Request validation returns real HTTP errors with `{code, message, field}` bodies instead of
  an empty 200: unknown filter or sort fields, bad values, bad `match` and `dir`, and an upper
  bound on `limit`. Upstream failures map to 502 with a short message. *(in flight)*
- The UI shows the server's actual error with a Retry button instead of `QUERY ERROR` and
  `undefinedms`. *(in flight)*

### Fixed

- The row detail drawer now opens, and closes on Escape or a click on the scrim. *(in flight)*
- Layout works below 900px: off-canvas rail, no page-level horizontal scroll. *(in flight)*
- `above_pct` and `below_pct` unpack their argument. The `high_52w`, `low_52w` and `breakouts`
  presets, the MCP `run_preset`, and the "above by %" operator returned zero rows before.
- Presets and the Value factor no longer depend on the dead `dividend_yield_recent` field;
  `dividends_yield_current` is used instead.
- Exponentiation in the computed-column sandbox is bounded. `9**9**9**9` used to pin a core and
  take down `/api/health`; it is now rejected.
- An empty `SCANLINE_HOST` no longer binds every interface.

[1.0.0]: https://github.com/mphinance/scanline/releases/tag/v1.0.0
