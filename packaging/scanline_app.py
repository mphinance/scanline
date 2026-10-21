"""PyInstaller entry point for the one-file Scanline binary.

    scanline            web app, opens your browser
    scanline mcp        MCP server over stdio (same flags as scanline-mcp)
"""

import sys
import traceback

from scanline import frozen


def _run() -> None:
    if frozen.wants_mcp(sys.argv):
        from scanline import mcp_server

        sys.argv = frozen.mcp_argv(sys.argv)
        mcp_server.main()
        return

    from scanline import cli

    cli.main()


def main() -> None:
    pause = frozen.should_pause(
        frozen.is_frozen(), sys.platform, bool(sys.stdout and sys.stdout.isatty())
    )
    mcp = frozen.wants_mcp(sys.argv)
    try:
        _run()
    except SystemExit as exc:
        if pause and not mcp and exc.code not in (None, 0):
            print(f"\nScanline stopped: {exc.code}")
            frozen.pause_for_enter()
        raise
    except KeyboardInterrupt:
        pass
    except BaseException:
        if pause and not mcp:
            traceback.print_exc()
            print("\nScanline crashed. The error is above.")
            frozen.pause_for_enter()
        raise
    else:
        if pause and not mcp:
            frozen.pause_for_enter()


if __name__ == "__main__":
    main()
