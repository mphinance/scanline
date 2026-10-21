"""HTTP API contract tests: validation, error statuses, caching, CORS.

Fully offline. Query.get_scanner_data is replaced by a fake, so these never
touch TradingView.
"""

from __future__ import annotations

import pandas as pd
import pytest
import requests
from fastapi.testclient import TestClient
from tradingview_screener import Query

from scanline import app as app_mod
from scanline import realtime
from scanline.cache import TTLCache
from scanline.pipeline import run_screen
from scanline.models import ScreenRequest

SECRET = "s3cretSESSIONidvalue123"


class Upstream:
    """Fake get_scanner_data that records calls and kwargs."""

    def __init__(self):
        self.calls = 0
        self.kwargs: list[dict] = []
        self.rows: list[dict] | None = None
        self.exc: Exception | None = None
        self.exc_when_cookies: Exception | None = None

    def __call__(self, query, **kwargs):
        self.calls += 1
        self.kwargs.append(kwargs)
        if self.exc_when_cookies is not None and kwargs.get("cookies"):
            raise self.exc_when_cookies
        if self.exc is not None:
            raise self.exc
        cols = list(query.query.get("columns", []))
        rows = self.rows if self.rows is not None else [
            {c: (1.0 if c not in ("name", "sector", "description") else "AAA") for c in cols}
        ]
        df = pd.DataFrame([[f"X:{r.get('name', 'AAA')}", *[r.get(c) for c in cols]] for r in rows],
                          columns=["ticker", *cols])
        return len(rows), df


@pytest.fixture
def up(monkeypatch, tmp_path):
    fake = Upstream()
    monkeypatch.setattr(Query, "get_scanner_data", lambda self, **kw: fake(self, **kw))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    monkeypatch.delenv("SCANLINE_TV_SESSIONID", raising=False)
    monkeypatch.delenv("SCANLINE_TV_SESSIONID_SIGN", raising=False)
    realtime._reset_rejection()
    from scanline import mcp_server
    app_mod._cache.clear()
    mcp_server._cache.clear()
    yield fake
    realtime._reset_rejection()
    app_mod._cache.clear()
    mcp_server._cache.clear()


@pytest.fixture
def client(up):
    return TestClient(app_mod.app, client=("127.0.0.1", 50000))


def _post(client, **body):
    return client.post("/api/screen", json=body)


# --- 1. silent empties become named errors ---------------------------------

@pytest.mark.parametrize("body,needle,code", [
    ({"filters": [{"field": "not_a_field", "op": ">", "value": 1}]}, "not_a_field", "unknown_field"),
    ({"filters": [{"field": "close", "op": ">", "value": "abc"}]}, "close", "bad_value"),
    ({"filters": [{"field": "close", "op": "wat", "value": 1}]}, "wat", "bad_operator"),
    ({"filters": [{"field": "close", "op": "between", "value": 5}]}, "close", "bad_value"),
    ({"columns": ["close", "nope_col"]}, "nope_col", "unknown_field"),
    ({"sort": [{"field": "nope_sort", "dir": "desc"}]}, "nope_sort", "unknown_sort_field"),
    ({"stats": [{"fn": "zscore", "field": "nope_stat"}]}, "nope_stat", "unknown_field"),
    ({"match": "xor"}, "match", "invalid_request"),
    ({"sort": [{"field": "close", "dir": "sideways"}]}, "dir", "invalid_request"),
    ({"stats": [{"fn": "bogus", "field": "close"}]}, "fn", "invalid_request"),
    ({"limit": 0}, "limit", "invalid_request"),
    ({"limit": 1001}, "limit", "invalid_request"),
    ({"offset": -1}, "offset", "invalid_request"),
])
def test_bad_requests_are_400_and_named(client, up, body, needle, code):
    r = _post(client, **body)
    assert r.status_code == 400, r.text
    meta = r.json()["meta"]
    assert needle in meta["error"]
    assert meta["error_code"] == code
    assert r.json()["rows"] == [] and r.json()["count"] == 0
    assert up.calls == 0, "validation must fail before any upstream call"


def test_validation_message_does_not_echo_submitted_value(client):
    r = _post(client, limit="my-private-value")
    assert r.status_code == 400
    assert "my-private-value" not in r.text


def test_valid_screen_is_200_with_shape(client, up):
    r = _post(client, filters=[{"field": "close", "op": ">", "value": "5"},
                               {"field": "close", "op": ">", "value": "open"},
                               {"field": "sector", "op": "==", "value": "Technology"}],
              sort=[{"field": "close", "dir": "asc"}])
    assert r.status_code == 200, r.text
    meta = r.json()["meta"]
    assert meta["error"] is None and meta["error_code"] is None
    assert meta["mode"] == "delayed"


def test_derived_sort_ids_are_accepted(client, up):
    r = _post(client, computed=[{"id": "dv", "expr": "close*volume"}],
              sort=[{"field": "dv", "dir": "desc"}])
    assert r.status_code == 200, r.text


# --- 2. upstream failures: 502, short message, same body shape -------------

def test_upstream_connection_error_is_502_and_short(client, up):
    up.exc = requests.exceptions.ConnectionError(
        "HTTPSConnectionPool(host='scanner.tradingview.com', port=443): Max retries exceeded")
    r = _post(client)
    assert r.status_code == 502
    meta = r.json()["meta"]
    assert meta["error_code"] == "upstream_unreachable"
    assert "HTTPSConnectionPool" not in r.text
    assert isinstance(meta["error"], str) and len(meta["error"]) < 100
    assert meta["detail"] == "ConnectionError"
    assert r.json()["rows"] == []


def test_upstream_429_and_timeout_codes(client, up):
    resp = requests.Response()
    resp.status_code = 429
    up.exc = requests.exceptions.HTTPError("429", response=resp)
    assert _post(client).json()["meta"]["error_code"] == "upstream_rate_limited"
    up.exc = requests.exceptions.Timeout("boom")
    r = _post(client, limit=2)
    assert r.status_code == 502 and r.json()["meta"]["error_code"] == "upstream_timeout"


def test_errors_are_not_cached(client, up):
    up.exc = requests.exceptions.ConnectionError("x")
    assert _post(client).status_code == 502
    up.exc = None
    assert _post(client).status_code == 200


def test_run_screen_never_raises_and_carries_code(up):
    up.exc = RuntimeError("anything")
    out = run_screen(ScreenRequest())
    assert out["meta"]["error_code"] == "upstream_error"
    assert "anything" not in out["meta"]["error"]


# --- 3. factor coverage -----------------------------------------------------

def test_factor_on_empty_columns_is_withheld_with_warning(client, up):
    up.rows = [{"name": "AAA", "close": 1.0}, {"name": "BBB", "close": 2.0}]
    r = _post(client, columns=["close"],
              factor={"weights": [{"field": "price_earnings_ttm", "weight": 1, "dir": "low"},
                                  {"field": "return_on_equity", "weight": 1, "dir": "high"}]})
    assert r.status_code == 200
    body = r.json()
    assert all(row["factor_score"] is None for row in body["rows"])
    assert body["meta"]["warnings"] and "withheld" in body["meta"]["warnings"][0]


def test_factor_with_data_still_scores(client, up):
    up.rows = [{"name": "AAA", "close": 1.0, "change": 3.0},
               {"name": "BBB", "close": 2.0, "change": 1.0}]
    r = _post(client, columns=["close", "change"],
              factor={"weights": [{"field": "change", "weight": 1, "dir": "high"}]})
    body = r.json()
    assert body["rows"][0]["factor_score"] is not None
    assert body["meta"]["warnings"] == []


# --- 4. limits and cache caps -------------------------------------------------

def test_cache_caps_entries_and_sweeps_expired(monkeypatch):
    c = TTLCache(ttl_seconds=100, max_entries=3)
    for i in range(10):
        c.set(f"k{i}", i)
    assert len(c) == 3
    assert c.get("k9") == 9 and c.get("k0") is None

    t = [1000.0]
    monkeypatch.setattr("scanline.cache.time.time", lambda: t[0])
    d = TTLCache(ttl_seconds=10, max_entries=256)
    d.set("a", 1)
    d.set("b", 2)
    t[0] += 11
    d.set("c", 3)
    assert len(d) == 1


# --- 5. CORS -------------------------------------------------------------------

def test_cors_default_loopback_only(client):
    ok = client.get("/api/health", headers={"Origin": "http://localhost:3000"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:3000"
    bad = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in bad.headers


def test_cors_env_override():
    assert app_mod.cors_settings("*") == {"allow_origins": ["*"]}
    assert app_mod.cors_settings("https://a.io, https://b.io/") == {
        "allow_origins": ["https://a.io", "https://b.io"]}
    assert "allow_origin_regex" in app_mod.cors_settings("")
    assert "allow_origin_regex" in app_mod.cors_settings(None)


# --- 6. health -------------------------------------------------------------------

def test_health_get_head_and_mode(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["mode"] == "delayed"
    assert client.head("/api/health").status_code == 200


# --- 7. MCP edge cases ---------------------------------------------------------

def _mcp(name, args):
    import asyncio
    from fastmcp import Client
    from scanline.mcp_server import mcp

    async def run():
        async with Client(mcp) as c:
            res = await c.call_tool(name, args, raise_on_error=False)
            return res

    return asyncio.run(run())


def test_mcp_limit_bounds_enforced_by_schema(up):
    for tool, args in [("screen", {"limit": 0}), ("screen", {"limit": 1001}),
                       ("run_preset", {"preset_id": "x", "limit": 5000}),
                       ("search_symbols", {"query": "a", "limit": 0})]:
        res = _mcp(tool, args)
        assert res.is_error, (tool, args)
    assert up.calls == 0


def test_mcp_screen_names_bad_field_and_match(up):
    res = _mcp("screen", {"filters": [{"field": "zzz", "op": ">", "value": 1}]})
    assert res.data["error_code"] == "unknown_field" and "zzz" in res.data["error"]
    assert _mcp("screen", {"match": "xor"}).is_error


def test_mcp_technical_rating_rejects_unknown_timeframe(up):
    out = _mcp("technical_rating", {"ticker": "AAPL", "timeframes": ["1d", "3x"]}).data
    assert "3x" in out["error"] and up.calls == 0


def test_mcp_technical_rating_weekly_uses_scanner_suffix(up):
    up.rows = [{"name": "AAPL"}]
    _mcp("technical_rating", {"ticker": "AAPL", "timeframes": ["1w"]})
    assert up.calls == 1


def test_mcp_compare_reports_unknown_tickers_and_columns(up):
    up.rows = [{"name": "NVDA"}]
    out = _mcp("compare", {"tickers": ["nvda", "ZZZZ"], "columns": ["name", "close"]}).data
    assert out["not_found"] == ["ZZZZ"]
    bad = _mcp("compare", {"tickers": ["NVDA"], "columns": ["name", "nope_col"]}).data
    assert "nope_col" in bad["error"]


def test_mcp_earnings_radar_horizon_errors_cleanly(up):
    from scanline import mcp_server
    fn = getattr(mcp_server.earnings_radar, "fn", mcp_server.earnings_radar)
    for bad in ("abc", None, 0, 9999, True, 2.5):
        out = fn(horizon=bad)
        assert out["error_code"] == "invalid_request", bad
    assert up.calls == 0


def test_mcp_upstream_error_has_code(up):
    up.exc = requests.exceptions.ConnectionError("HTTPSConnectionPool x")
    out = _mcp("screen", {}).data
    assert out["error_code"] == "upstream_unreachable"
    assert "HTTPSConnectionPool" not in str(out)
