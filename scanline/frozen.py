"""Helpers for the one-file PyInstaller binary (see packaging/).

The pure decisions live here so they can be unit tested on any OS. The only
thing that touches the console is `pause_for_enter`, and it is only called
from the frozen entry script.
"""

from __future__ import annotations

import sys

MCP_SUBCOMMAND = "mcp"


def is_frozen() -> bool:
    """True when running inside a PyInstaller bundle."""
    return bool(getattr(sys, "frozen", False))


def should_pause(frozen: bool, platform: str, stdout_is_tty: bool) -> bool:
    """Keep the console window open only for a double-clicked Windows binary.

    A double-click opens a fresh console that vanishes the moment the process
    exits, taking any error message with it. On other platforms, or when output
    is piped (CI, scripts), waiting for Enter would just hang.
    """
    return bool(frozen and platform.startswith("win") and stdout_is_tty)


def wants_mcp(argv: list[str]) -> bool:
    """True when the first argument asks for the MCP server."""
    return len(argv) > 1 and argv[1] == MCP_SUBCOMMAND


def mcp_argv(argv: list[str]) -> list[str]:
    """argv for scanline.mcp_server.main: drop the `mcp` subcommand."""
    return [argv[0]] + argv[2:]


def pause_for_enter(message: str = "Press Enter to close this window...") -> None:
    try:
        input(message)
    except (EOFError, KeyboardInterrupt):
        pass
