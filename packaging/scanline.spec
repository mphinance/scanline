# PyInstaller spec for the one-file Scanline binary.
#
#   pyinstaller packaging/scanline.spec --noconfirm
#
# Run from the repo root. Output: dist/scanline (dist/scanline.exe on Windows).
# CI renames it per OS, see .github/workflows/release.yml.
import os
from PyInstaller.utils.hooks import collect_all, collect_submodules

root = os.path.abspath(os.path.join(SPECPATH, ".."))

datas = [
    (os.path.join(root, "frontend", "index.html"), "scanline/static"),
    (os.path.join(root, "frontend", "css"), "scanline/static/css"),
    (os.path.join(root, "frontend", "js"), "scanline/static/js"),
    (os.path.join(root, "scanline", "fields_all.json"), "scanline"),
]
binaries = []
hiddenimports = [
    "scanline.app",
    "scanline.cli",
    "scanline.mcp_server",
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
]
hiddenimports += collect_submodules("uvicorn")
hiddenimports += collect_submodules("scanline")

# Packages that load plugins or data files dynamically.
for pkg in ("fastmcp", "tradingview_screener", "mcp", "certifi"):
    try:
        d, b, h = collect_all(pkg)
    except Exception:
        continue
    datas += d
    binaries += b
    hiddenimports += h

a = Analysis(
    [os.path.join(root, "packaging", "scanline_app.py")],
    pathex=[root],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "pytest", "matplotlib", "IPython"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="scanline",
    debug=False,
    strip=False,
    upx=False,
    console=True,
)
