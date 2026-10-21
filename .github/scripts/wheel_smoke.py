"""Install the built wheel into a clean venv and prove it actually serves.

Usage: python .github/scripts/wheel_smoke.py dist/*.whl

Runs `scanline --help`, starts `scanline --no-browser --port 8765`, polls
/api/health and GET / until both return 200, then kills the server. Works on
Linux, macOS and Windows. This is the check that catches packaging bugs
(missing static files, wrong entry points) that the source-tree tests cannot.
"""

from __future__ import annotations

import glob
import subprocess
import sys
import tempfile
import time
import urllib.request
import venv
from pathlib import Path

PORT = 8765
BASE = f"http://127.0.0.1:{PORT}"


def get(path: str) -> int:
    with urllib.request.urlopen(BASE + path, timeout=3) as resp:
        return resp.status


def main() -> int:
    wheels = [w for pat in sys.argv[1:] for w in glob.glob(pat)]
    if len(wheels) != 1:
        print(f"expected exactly one wheel, got {wheels}")
        return 2

    with tempfile.TemporaryDirectory() as tmp:
        env_dir = Path(tmp) / "venv"
        venv.EnvBuilder(with_pip=True, clear=True).create(env_dir)
        bindir = env_dir / ("Scripts" if sys.platform == "win32" else "bin")
        exe = ".exe" if sys.platform == "win32" else ""
        py, scanline = bindir / f"python{exe}", bindir / f"scanline{exe}"

        subprocess.run([str(py), "-m", "pip", "install", "-q", wheels[0]], check=True)
        subprocess.run([str(scanline), "--help"], check=True)

        # Run from the temp dir so nothing resolves against the source checkout.
        proc = subprocess.Popen(
            [str(scanline), "--no-browser", "--port", str(PORT)], cwd=tmp
        )
        try:
            deadline = time.monotonic() + 90
            ok: set[str] = set()
            while time.monotonic() < deadline and ok != {"/api/health", "/"}:
                if proc.poll() is not None:
                    print(f"server exited early with code {proc.returncode}")
                    return 1
                for path in ("/api/health", "/"):
                    try:
                        if get(path) == 200:
                            ok.add(path)
                    except Exception:
                        pass
                time.sleep(0.5)
            if ok != {"/api/health", "/"}:
                print(f"timed out; got 200 from {sorted(ok)}")
                return 1
            print("wheel smoke ok: /api/health and / both 200")
            return 0
        finally:
            proc.kill()
            proc.wait()


if __name__ == "__main__":
    sys.exit(main())
