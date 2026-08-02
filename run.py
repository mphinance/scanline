"""Launch the Scanline backend.

Run with: python run.py
Serves the API and static frontend on http://127.0.0.1:8000

Accepts the same flags as the installed `scanline` command, so
`python run.py --port 9000` works from a checkout. See backend/cli.py.
"""

from backend.cli import main

if __name__ == "__main__":
    main()
