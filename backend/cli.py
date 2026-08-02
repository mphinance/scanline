"""Launcher for the web app, shared by `run.py` and the `scanline` command.

Host and port resolve in this order, first hit wins:

  1. CLI flags:  scanline --host 0.0.0.0 --port 9000
  2. Environment: SCANLINE_HOST, SCANLINE_PORT
  3. Defaults:   127.0.0.1:8000

The default stays loopback on purpose. This app proxies an upstream data
source, so binding it to every interface is a choice the operator makes
deliberately, not one that happens by accident. The Docker image sets
SCANLINE_HOST=0.0.0.0 because a container port is already a deliberate publish.
"""

from __future__ import annotations

import argparse
import os

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000


def _env_port() -> int:
    """SCANLINE_PORT as an int, falling back to the default if unset or junk."""
    raw = os.environ.get("SCANLINE_PORT", "").strip()
    if not raw:
        return DEFAULT_PORT
    try:
        return int(raw)
    except ValueError:
        return DEFAULT_PORT


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Resolve host, port, and reload from flags then environment."""
    parser = argparse.ArgumentParser(
        prog="scanline",
        description="Serve the Scanline screener (API plus static frontend).",
    )
    parser.add_argument(
        "--host",
        default=os.environ.get("SCANLINE_HOST", DEFAULT_HOST),
        help="interface to bind (default 127.0.0.1, env SCANLINE_HOST)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=_env_port(),
        help="port to bind (default 8000, env SCANLINE_PORT)",
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        help="reload on code changes (development only)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    """Entry point for both `python run.py` and the `scanline` console script."""
    args = parse_args(argv)

    # Imported here, not at module scope, so --help stays instant and a missing
    # optional dependency surfaces as a real error rather than an import crash.
    import uvicorn

    shown = "127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host
    print(f"Scanline running at http://{shown}:{args.port}/")
    print(f"API docs at http://{shown}:{args.port}/docs")
    uvicorn.run("backend.app:app", host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
