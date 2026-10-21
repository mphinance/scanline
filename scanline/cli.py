"""Launcher for the web app, shared by `run.py` and the `scanline` command.

Host and port resolve in this order, first hit wins:

  1. CLI flags:  scanline --host 0.0.0.0 --port 9000
  2. Environment: SCANLINE_HOST, SCANLINE_PORT
  3. Defaults:   127.0.0.1:8000

Launch UX: once the server answers /api/health the default browser opens on
it. `--no-browser` or SCANLINE_NO_BROWSER skips that. It never opens for a
non-loopback bind, inside Docker, or under CI. If the port is taken and was not
asked for explicitly, the next 10 ports are tried.

The default stays loopback on purpose. This app proxies an upstream data
source, so binding it to every interface is a choice the operator makes
deliberately, not one that happens by accident. The Docker image sets
SCANLINE_HOST=0.0.0.0 because a container port is already a deliberate publish.
"""

from __future__ import annotations

import argparse
import ipaddress
import os
import socket
import threading
import time
import urllib.request
import webbrowser

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000
PORT_TRIES = 10


def _env_host() -> str:
    """SCANLINE_HOST, falling back to the default if unset or blank.

    `os.environ.get(name, default)` is not enough here. A variable that is set
    but empty (`SCANLINE_HOST=` in a compose environment list, a bare line in a
    .env, `export SCANLINE_HOST=` in a wrapper) returns "", and uvicorn reads ""
    as INADDR_ANY. That fails open: the loopback default this module promises
    would silently become every interface.
    """
    return os.environ.get("SCANLINE_HOST", "").strip() or DEFAULT_HOST


def _env_port() -> int:
    """SCANLINE_PORT as an int, falling back to the default if unset or junk."""
    raw = os.environ.get("SCANLINE_PORT", "").strip()
    if not raw:
        return DEFAULT_PORT
    try:
        return int(raw)
    except ValueError:
        return DEFAULT_PORT


def _env_port_set() -> bool:
    """True when SCANLINE_PORT holds a usable integer."""
    raw = os.environ.get("SCANLINE_PORT", "").strip()
    try:
        int(raw)
    except ValueError:
        return False
    return True


def is_loopback(host: str) -> bool:
    """True for 127.0.0.0/8, ::1 and `localhost`. Anything else is not."""
    host = host.strip().strip("[]")
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() not in ("", "0", "false", "no", "off")


def in_container_or_ci(environ=None, dockerenv: str = "/.dockerenv") -> bool:
    """Best-effort detection of Docker and CI, where a browser makes no sense."""
    env = os.environ if environ is None else environ
    if _truthy(env.get("CI")) or _truthy(env.get("GITHUB_ACTIONS")):
        return True
    if _truthy(env.get("SCANLINE_IN_DOCKER")):
        return True
    return os.path.exists(dockerenv)


def should_open_browser(args, environ=None, dockerenv: str = "/.dockerenv") -> bool:
    """Decide whether to launch a browser tab once the server is up."""
    env = os.environ if environ is None else environ
    if getattr(args, "no_browser", False) or _truthy(env.get("SCANLINE_NO_BROWSER")):
        return False
    if not is_loopback(args.host):
        return False
    return not in_container_or_ci(env, dockerenv)


def port_is_free(host: str, port: int) -> bool:
    """True if we can bind host:port right now."""
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    with socket.socket(family, socket.SOCK_STREAM) as sock:
        try:
            sock.bind((host, port))
        except OSError:
            return False
    return True


def pick_port(host: str, port: int, explicit: bool, is_free=port_is_free) -> int:
    """Return a bindable port, or raise OSError with a message worth reading.

    Explicit ports are never moved. The default tries itself plus the next
    PORT_TRIES ports.
    """
    if is_free(host, port):
        return port
    if explicit:
        raise OSError(
            f"port {port} on {host} is already in use. "
            "Pick another with --port, or stop whatever holds it."
        )
    for candidate in range(port + 1, port + 1 + PORT_TRIES):
        if is_free(host, candidate):
            return candidate
    raise OSError(
        f"ports {port} to {port + PORT_TRIES} on {host} are all in use. "
        "Pass --port with a free one."
    )


def _open_when_ready(url: str, timeout: float = 30.0, opener=webbrowser.open) -> bool:
    """Poll /api/health, then open the browser. Returns True if it opened."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url + "api/health", timeout=2) as resp:
                if resp.status == 200:
                    opener(url)
                    return True
        except Exception:
            pass
        time.sleep(0.25)
    return False


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Resolve host, port, and reload from flags then environment."""
    parser = argparse.ArgumentParser(
        prog="scanline",
        description="Serve the Scanline screener (API plus static frontend).",
    )
    parser.add_argument(
        "--host",
        default=_env_host(),
        help="interface to bind (default 127.0.0.1, env SCANLINE_HOST)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help="port to bind (default 8000, env SCANLINE_PORT)",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="do not open a browser tab (env SCANLINE_NO_BROWSER)",
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        help="reload on code changes (development only)",
    )
    args = parser.parse_args(argv)
    # An explicit port (flag, or a valid env value) is a promise: if it is
    # busy we fail rather than quietly move. Only the default may slide.
    args.port_explicit = args.port is not None or _env_port_set()
    if args.port is None:
        args.port = _env_port()
    # Normalize here rather than only in _env_host, so an explicit `--host ""`
    # or `--host "  "` cannot bind every interface either. Loopback is the
    # documented default and there is no input that should quietly widen it.
    args.host = args.host.strip() or DEFAULT_HOST
    return args


def main(argv: list[str] | None = None) -> None:
    """Entry point for both `python run.py` and the `scanline` console script."""
    args = parse_args(argv)

    # Imported here, not at module scope, so --help stays instant and a missing
    # optional dependency surfaces as a real error rather than an import crash.
    import uvicorn

    try:
        port = pick_port(args.host, args.port, args.port_explicit)
    except OSError as exc:
        raise SystemExit(f"scanline: {exc}")
    if port != args.port:
        print(f"Port {args.port} is busy, using {port} instead.")
    args.port = port

    shown = "127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host
    url = f"http://{shown}:{args.port}/"
    print(f"Scanline running at {url}")
    print(f"API docs at {url}docs")
    print("Delayed data, no key needed; see docs/REALTIME.md for real-time.")

    if should_open_browser(args):
        threading.Thread(target=_open_when_ready, args=(url,), daemon=True).start()

    extra: dict = {}
    if args.reload:
        # uvicorn otherwise watches os.getcwd(), which is wherever the user
        # happened to be. Run from $HOME that means recursively watching the
        # home directory while never watching the code being edited. Point it
        # at the tree that actually holds the backend package.
        extra["reload_dirs"] = [
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        ]

    uvicorn.run(
        "scanline.app:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        **extra,
    )


if __name__ == "__main__":
    main()
