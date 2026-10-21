"""Real-time mode: the TradingView session cookie.

The invariant under test: the cookie reaches requests (and only requests). It
must never appear in a response body, an error repr, a log line or a cache key.
"""

from __future__ import annotations

import json
import logging
import os
import stat

import pytest
import requests
from fastapi.testclient import TestClient

from scanline import app as app_mod
from scanline import realtime
from scanline.models import ScreenRequest
from scanline.pipeline import request_key, run_screen

from tests.test_api import Upstream, up  # noqa: F401  (fixture re-export)

SID = "SECRETsessionID0123456789"
SIGN = "SECRETsignVALUE0123456789"


@pytest.fixture
def client(up):  # noqa: F811
    return TestClient(app_mod.app, client=("127.0.0.1", 50000))


def _http_error(status: int) -> requests.exceptions.HTTPError:
    resp = requests.Response()
    resp.status_code = status
    return requests.exceptions.HTTPError(f"{status} for url", response=resp)


def test_env_cookie_is_passed_to_requests(up, monkeypatch):
    monkeypatch.setenv("SCANLINE_TV_SESSIONID", SID)
    monkeypatch.setenv("SCANLINE_TV_SESSIONID_SIGN", SIGN)
    out = run_screen(ScreenRequest())
    assert out["meta"]["error"] is None
    assert up.kwargs[-1]["cookies"] == {"sessionid": SID, "sessionid_sign": SIGN}
    assert out["meta"]["mode"] == "realtime"


def test_no_cookie_means_no_cookies_kwarg(up):
    run_screen(ScreenRequest())
    assert "cookies" not in up.kwargs[-1]


def test_file_cookie_is_used_and_is_0600(client, up, tmp_path):
    r = client.post("/api/settings/cookie", json={"sessionid": SID})
    assert r.status_code == 200 and r.json() == {"configured": True, "mode": "realtime"}
    path = realtime.config_path()
    assert path.parent == tmp_path / "scanline"
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert json.loads(path.read_text())["sessionid"] == SID
    client.post("/api/screen", json={})
    assert up.kwargs[-1]["cookies"] == {"sessionid": SID}


def test_env_beats_file(up, monkeypatch):
    realtime.save_cookie(SID)
    monkeypatch.setenv("SCANLINE_TV_SESSIONID", "ENVsessionVALUE9999")
    run_screen(ScreenRequest())
    assert up.kwargs[-1]["cookies"]["sessionid"] == "ENVsessionVALUE9999"


def test_cookie_never_in_any_response_body(client, up):
    bodies = []
    r = client.post("/api/settings/cookie", json={"sessionid": SID, "sessionid_sign": SIGN})
    bodies.append(r.text)
    bodies.append(client.get("/api/settings/cookie").text)
    bodies.append(client.get("/api/health").text)
    bodies.append(client.post("/api/screen", json={}).text)
    bodies.append(client.post("/api/screen", json={}).text)  # cached path
    up.exc = requests.exceptions.ConnectionError(f"cookie {SID}")  # even if lib text had it
    bodies.append(client.post("/api/screen", json={"limit": 3}).text)
    up.exc = None
    bodies.append(client.post("/api/screen", json={"match": "xor", "limit": SID}).text)
    bodies.append(client.delete("/api/settings/cookie").text)
    for b in bodies:
        assert SID not in b and SIGN not in b


def test_bad_cookie_post_does_not_echo_value(client):
    bad = "has spaces and ; semicolons " + SID
    r = client.post("/api/settings/cookie", json={"sessionid": bad})
    assert r.status_code == 400
    assert SID not in r.text and "semicolons" not in r.text
    assert client.post("/api/settings/cookie", json=["x"]).status_code == 400
    assert client.post("/api/settings/cookie", content=b"nope",
                       headers={"content-type": "application/json"}).status_code == 400
    assert client.get("/api/settings/cookie").json()["configured"] is False


def test_cookie_absent_from_errors_and_logs(up, monkeypatch, caplog):
    monkeypatch.setenv("SCANLINE_TV_SESSIONID", SID)
    caplog.set_level(logging.DEBUG)
    up.exc_when_cookies = RuntimeError(f"boom {SID}")
    out = run_screen(ScreenRequest())
    assert out["meta"]["error_code"] == "upstream_error"
    assert SID not in repr(out)
    assert SID not in caplog.text


def test_exception_chain_does_not_carry_cookie(up, monkeypatch):
    from scanline.screener import ScreenerError, run_query
    monkeypatch.setenv("SCANLINE_TV_SESSIONID", SID)
    up.exc_when_cookies = RuntimeError(f"boom {SID}")
    with pytest.raises(ScreenerError) as ei:
        run_query()
    assert ei.value.__cause__ is None and ei.value.__suppress_context__
    assert SID not in repr(ei.value) and SID not in str(ei.value)


def test_mode_is_in_cache_key(up, monkeypatch):
    req = ScreenRequest()
    k_delayed = request_key(req)
    monkeypatch.setenv("SCANLINE_TV_SESSIONID", SID)
    k_real = request_key(req)
    assert k_delayed != k_real
    assert SID not in k_real
    # different cookie, same mode: same key (the value is not part of the key)
    monkeypatch.setenv("SCANLINE_TV_SESSIONID", "ANOTHERsession123456")
    assert request_key(req) == k_real


def test_realtime_and_delayed_results_do_not_share_cache(client, up, monkeypatch):
    client.post("/api/screen", json={})
    assert up.calls == 1
    monkeypatch.setenv("SCANLINE_TV_SESSIONID", SID)
    r = client.post("/api/screen", json={})
    assert up.calls == 2 and r.json()["meta"]["cached"] is False


@pytest.mark.parametrize("status", [401, 403])
def test_rejected_cookie_falls_back_cookieless(client, up, monkeypatch, status):
    monkeypatch.setenv("SCANLINE_TV_SESSIONID", SID)
    up.exc_when_cookies = _http_error(status)
    r = client.post("/api/screen", json={})
    assert r.status_code == 200
    assert r.json()["meta"]["mode"] == "cookie_rejected"
    assert up.kwargs[0].get("cookies") and "cookies" not in up.kwargs[1]
    assert client.get("/api/health").json()["mode"] == "cookie_rejected"
    assert client.get("/api/settings/cookie").json() == {"configured": True,
                                                         "mode": "cookie_rejected"}
    # While rejected, later queries do not resend the cookie.
    client.post("/api/screen", json={"limit": 7})
    assert "cookies" not in up.kwargs[-1]
    assert SID not in r.text


def test_other_http_errors_do_not_reject_cookie(up, monkeypatch):
    monkeypatch.setenv("SCANLINE_TV_SESSIONID", SID)
    up.exc_when_cookies = _http_error(500)
    out = run_screen(ScreenRequest())
    assert out["meta"]["error_code"] == "upstream_error"
    assert realtime.mode() == "realtime"


def test_rejection_expires_and_resets_on_new_cookie(up, monkeypatch):
    monkeypatch.setenv("SCANLINE_TV_SESSIONID", SID)
    realtime.mark_rejected()
    assert realtime.mode() == "cookie_rejected"
    # Scoped patch: a bare monkeypatch.undo() would also revert the config-home
    # redirect and let save_cookie below write the developer's real cookie file.
    with monkeypatch.context() as m:
        m.setattr(realtime.time, "time", lambda: 10**12)
        assert realtime.mode() == "realtime"
    monkeypatch.setenv("SCANLINE_TV_SESSIONID", SID)
    realtime.mark_rejected()
    realtime.save_cookie(SID)
    assert realtime.mode() == "realtime"


def test_delete_clears_and_returns_to_delayed(client, up):
    client.post("/api/settings/cookie", json={"sessionid": SID})
    r = client.delete("/api/settings/cookie")
    assert r.json() == {"configured": False, "mode": "delayed"}
    assert not realtime.config_path().exists()
    client.post("/api/screen", json={})
    assert "cookies" not in up.kwargs[-1]


def test_settings_reject_non_loopback_and_cross_origin(up):
    remote = TestClient(app_mod.app, client=("203.0.113.9", 4000))
    assert remote.post("/api/settings/cookie", json={"sessionid": SID}).status_code == 403
    assert remote.delete("/api/settings/cookie").status_code == 403
    local = TestClient(app_mod.app, client=("127.0.0.1", 4000))
    assert local.post("/api/settings/cookie", json={"sessionid": SID},
                      headers={"Origin": "https://evil.example"}).status_code == 403
    assert local.post("/api/settings/cookie", json={"sessionid": SID},
                      headers={"X-Forwarded-For": "8.8.8.8"}).status_code == 403
    assert local.post("/api/settings/cookie", json={"sessionid": SID},
                      headers={"Origin": "http://localhost:8000"}).status_code == 200
    assert not realtime.config_path().exists() or realtime.configured()


def test_status_get_is_open_but_leaks_nothing(up):
    remote = TestClient(app_mod.app, client=("203.0.113.9", 4000))
    assert remote.get("/api/settings/cookie").json() == {"configured": False, "mode": "delayed"}


def test_mcp_path_uses_cookie_and_shapes_mode(up, monkeypatch):
    import asyncio
    from fastmcp import Client
    from scanline.mcp_server import mcp
    monkeypatch.setenv("SCANLINE_TV_SESSIONID", SID)

    async def run():
        async with Client(mcp) as c:
            return (await c.call_tool("screen", {})).data

    out = asyncio.run(run())
    assert up.kwargs[-1]["cookies"] == {"sessionid": SID}
    assert out["mode"] == "realtime" and SID not in repr(out)
