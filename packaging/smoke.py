"""Smoke-test a built binary: start it, poll /api/health, check /, kill it.

    python packaging/smoke.py dist/scanline-linux
"""

import subprocess
import sys
import time
import urllib.request

PORT = 8160


def get(path: str) -> int:
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=5) as r:
        return r.status


def main() -> int:
    exe = sys.argv[1]
    proc = subprocess.Popen([exe, "--no-browser", "--port", str(PORT)])
    try:
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                print(f"binary exited early with code {proc.returncode}")
                return 1
            try:
                if get("/api/health") == 200:
                    break
            except Exception:
                time.sleep(1)
        else:
            print("timed out waiting for /api/health")
            return 1
        for path in ("/", "/api/presets"):
            status = get(path)
            print(f"GET {path} -> {status}")
            if status != 200:
                return 1
        print("smoke ok")
        return 0
    finally:
        proc.kill()
        proc.wait()


if __name__ == "__main__":
    sys.exit(main())
