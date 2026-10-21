"""Launch the Scanline MCP server.

Default transport is stdio, which is what Claude Desktop and Claude Code expect:

    python run_mcp.py

For a remote / multi-client setup, serve streamable-http on a port:

    python run_mcp.py --http 8765

The server exposes the same live screen engine the web app uses (no TradingView
account needed). See scanline/mcp_server.py for the tool catalog.
"""

from scanline.mcp_server import main

if __name__ == "__main__":
    main()
