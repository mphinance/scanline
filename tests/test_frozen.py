"""Pure-logic tests for the PyInstaller launcher helpers. No server, no console."""

from scanline.frozen import mcp_argv, should_pause, wants_mcp


def test_pause_only_for_frozen_windows_console():
    assert should_pause(True, "win32", True)
    assert not should_pause(False, "win32", True)
    assert not should_pause(True, "win32", False)
    assert not should_pause(True, "linux", True)
    assert not should_pause(True, "darwin", True)


def test_wants_mcp():
    assert wants_mcp(["scanline", "mcp"])
    assert wants_mcp(["scanline", "mcp", "--http", "8765"])
    assert not wants_mcp(["scanline"])
    assert not wants_mcp(["scanline", "--port", "8000"])
    assert not wants_mcp(["scanline", "--no-browser", "mcp"])


def test_mcp_argv_drops_subcommand():
    assert mcp_argv(["scanline", "mcp", "--http", "8765"]) == ["scanline", "--http", "8765"]
    assert mcp_argv(["scanline", "mcp"]) == ["scanline"]
