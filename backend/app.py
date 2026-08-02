"""FastAPI app: routes, static mount, CORS.

Thin HTTP layer over the shared screen pipeline (backend/pipeline.py): cache
check, delegate to run_screen, stamp cache metadata, serve the static frontend.
"""

from __future__ import annotations

import os
import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .cache import TTLCache, make_key
from .fields import FIELDS, MARKET_FIELDS
from .models import ScreenRequest, ScreenResponse
from .pipeline import run_screen
from .presets import FACTOR_PRESETS, PRESETS
from .screener import MARKETS

app = FastAPI(title="Scanline API", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_cache = TTLCache(ttl_seconds=20)


@app.get("/api/health")
def health() -> dict:
    """Liveness and catalog sizes."""
    return {
        "ok": True,
        "markets": len(MARKETS),
        "fields": len(FIELDS),
        "presets": len(PRESETS),
        "factor_presets": len(FACTOR_PRESETS),
    }


@app.get("/api/markets")
def markets() -> list[dict]:
    """Available markets."""
    return MARKETS


@app.get("/api/fields")
def fields() -> dict:
    """The field catalog plus per-market relevance hints."""
    return {"fields": FIELDS, "market_fields": MARKET_FIELDS}


@app.get("/api/presets")
def presets() -> dict:
    """Preset scans and factor-scoring presets."""
    return {"presets": PRESETS, "factor_presets": FACTOR_PRESETS}


@app.get("/api/factor-presets")
def factor_presets() -> list[dict]:
    """Factor-scoring presets only."""
    return FACTOR_PRESETS


@app.post("/api/screen", response_model=ScreenResponse)
def screen(req: ScreenRequest) -> JSONResponse:
    """Run the full screen pipeline and return shaped results."""
    started = time.time()
    key = make_key(req.model_dump())

    cached = _cache.get(key)
    if cached is not None:
        cached = dict(cached)
        cached["meta"] = {
            **cached["meta"],
            "cached": True,
            "ms": int((time.time() - started) * 1000),
        }
        return JSONResponse(cached)

    response = run_screen(req)
    # Only cache real results, never an upstream error response.
    if response["meta"].get("error") is None:
        _cache.set(key, response)
    return JSONResponse(response)


def _find_frontend() -> str | None:
    """Locate the static frontend, or None if this is an API-only install.

    Three shapes have to work: an explicit override, a git checkout where
    frontend/ sits beside backend/, and an installed wheel where the same files
    land next to the package as scanline_frontend (see pyproject.toml's
    force-include). Both of the latter share a parent, so they are one lookup.
    """
    parent = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    candidates = [
        os.environ.get("SCANLINE_FRONTEND_DIR", "").strip(),
        os.path.join(parent, "frontend"),
        os.path.join(parent, "scanline_frontend"),
    ]
    for path in candidates:
        if path and os.path.exists(os.path.join(path, "index.html")):
            return path
    return None


# Mount the static frontend at root if we found it. An API-only deployment (or
# a partial checkout) is tolerated: the /api routes above still serve.
_FRONTEND_DIR = _find_frontend()
if _FRONTEND_DIR:
    app.mount("/", StaticFiles(directory=_FRONTEND_DIR, html=True), name="frontend")
