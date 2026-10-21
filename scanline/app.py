"""FastAPI app: routes, static mount, CORS.

Thin HTTP layer over the shared screen pipeline (scanline/pipeline.py): cache
check, delegate to run_screen, stamp cache metadata, serve the static frontend.
"""

from __future__ import annotations

import ipaddress
import os
import re
import time

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import realtime
from .cache import TTLCache
from .fields import FIELDS, MARKET_FIELDS
from .models import ScreenRequest, ScreenResponse
from .pipeline import request_key, run_screen
from .presets import FACTOR_PRESETS, PRESETS
from .screener import MARKETS, VALIDATION_CODES

app = FastAPI(title="Scanline API", version="1.0")

# Loopback origins only by default: a local screener has no business answering
# arbitrary websites. SCANLINE_CORS_ORIGINS overrides ("*" or a comma list).
LOOPBACK_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$"


def cors_settings(env_value: str | None) -> dict:
    """CORSMiddleware kwargs for the given SCANLINE_CORS_ORIGINS value."""
    raw = (env_value or "").strip()
    if not raw:
        return {"allow_origins": [], "allow_origin_regex": LOOPBACK_ORIGIN_REGEX}
    if raw == "*":
        return {"allow_origins": ["*"]}
    origins = [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
    return {"allow_origins": origins}


app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    **cors_settings(os.environ.get("SCANLINE_CORS_ORIGINS")),
)

_cache = TTLCache(ttl_seconds=20)


def _error_body(message: str, code: str, detail: str | None = None) -> dict:
    """The screen response shape carrying an error."""
    return {
        "count": 0, "rows": [], "columns": [],
        "meta": {"cached": False, "ms": 0, "market": "america", "error": message,
                 "error_code": code, "detail": detail, "mode": realtime.mode(),
                 "warnings": []},
    }


@app.exception_handler(RequestValidationError)
async def _validation_error(request: Request, exc: RequestValidationError):
    """Bad /api/screen bodies get HTTP 400 in the same JSON shape as every other
    screen error. Other routes keep FastAPI's default. Messages carry the field
    path and rule, never the submitted value."""
    if request.url.path != "/api/screen":
        return await request_validation_exception_handler(request, exc)
    parts = []
    for err in exc.errors()[:3]:
        loc = ".".join(str(p) for p in err.get("loc", ()) if p != "body")
        parts.append(f"{loc}: {err.get('msg')}")
    return JSONResponse(
        _error_body("Invalid request. " + "; ".join(parts), "invalid_request",
                    f"{len(exc.errors())} validation error(s)"),
        status_code=400,
    )


@app.api_route("/api/health", methods=["GET", "HEAD"])
def health() -> dict:
    """Liveness and catalog sizes. `mode` is delayed | realtime | cookie_rejected."""
    return {
        "ok": True,
        "mode": realtime.mode(),
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

    cached = _cache.get(request_key(req))
    if cached is not None:
        cached = dict(cached)
        cached["meta"] = {
            **cached["meta"],
            "cached": True,
            "ms": int((time.time() - started) * 1000),
        }
        return JSONResponse(cached)

    response = run_screen(req)
    meta = response["meta"]
    if meta.get("error") is not None:
        # Same JSON body the frontend already reads, with a real status.
        status = 400 if meta.get("error_code") in VALIDATION_CODES or \
            meta.get("error_code") == "invalid_request" else 502
        return JSONResponse(response, status_code=status)
    # Only cache real results. The key is re-derived so a cookie rejected
    # mid-run is stored under the mode that actually served the data.
    _cache.set(request_key(req), response)
    return JSONResponse(response)


# --- real-time mode: session cookie settings -------------------------------

def _is_loopback_request(request: Request) -> bool:
    """True only for a direct loopback client with no proxy forwarding."""
    if any(h in request.headers for h in ("x-forwarded-for", "forwarded", "x-real-ip")):
        return False
    host = request.client.host if request.client else ""
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


_LOOPBACK_ORIGIN = re.compile(LOOPBACK_ORIGIN_REGEX)


def _guard_settings(request: Request) -> JSONResponse | None:
    """Cookie writes are local-only: loopback client, and a loopback (or absent)
    Origin so a random website cannot drive them through the user's browser."""
    if not _is_loopback_request(request):
        return JSONResponse({"error": "Cookie settings are only available from the local machine.",
                             "error_code": "forbidden"}, status_code=403)
    origin = request.headers.get("origin")
    if origin and not _LOOPBACK_ORIGIN.match(origin):
        return JSONResponse({"error": "Cross-origin cookie changes are refused.",
                             "error_code": "forbidden"}, status_code=403)
    return None


def _cookie_status() -> dict:
    return {"configured": realtime.configured(), "mode": realtime.mode()}


@app.get("/api/settings/cookie")
def cookie_status() -> dict:
    """Whether a TradingView cookie is set, and the resulting mode. Never the value."""
    return _cookie_status()


@app.post("/api/settings/cookie")
async def cookie_set(request: Request) -> JSONResponse:
    """Store the TradingView sessionid (and optional sessionid_sign) for
    real-time data. The body is parsed by hand so no validation error can echo
    the submitted value back."""
    denied = _guard_settings(request)
    if denied:
        return denied
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = None
    if not isinstance(body, dict):
        return JSONResponse({"error": "Send a JSON object with a sessionid.",
                             "error_code": "invalid_request"}, status_code=400)
    sid, sign = body.get("sessionid"), body.get("sessionid_sign")
    try:
        realtime.save_cookie(sid, sign if sign else None)
    except ValueError as exc:  # fixed messages, never the value
        return JSONResponse({"error": str(exc), "error_code": "invalid_request"},
                            status_code=400)
    except OSError:
        return JSONResponse({"error": "Could not write the cookie file.",
                             "error_code": "storage_error"}, status_code=500)
    _cache.clear()
    return JSONResponse(_cookie_status())


@app.delete("/api/settings/cookie")
def cookie_clear(request: Request) -> JSONResponse:
    """Forget the stored cookie (file only; an env-provided cookie stays)."""
    denied = _guard_settings(request)
    if denied:
        return denied
    try:
        realtime.clear_cookie()
    except OSError:
        return JSONResponse({"error": "Could not remove the cookie file.",
                             "error_code": "storage_error"}, status_code=500)
    _cache.clear()
    return JSONResponse(_cookie_status())


def _find_frontend() -> str | None:
    """Locate the static frontend, or None if this is an API-only install.

    Three shapes have to work: an explicit override, a git checkout where
    frontend/ sits beside scanline/, and an installed wheel where the same files
    land inside the package as scanline/static (see pyproject.toml's
    force-include).
    """
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.environ.get("SCANLINE_FRONTEND_DIR", "").strip(),
        os.path.join(os.path.dirname(here), "frontend"),
        os.path.join(here, "static"),
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
