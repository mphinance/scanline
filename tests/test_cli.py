"""Pure-logic tests for the launch UX in scanline/cli.py. No server, no network."""

import socket
from types import SimpleNamespace

import pytest

from scanline.cli import (
    _open_when_ready,
    in_container_or_ci,
    is_loopback,
    parse_args,
    pick_port,
    should_open_browser,
)

NO_DOCKER = "/nonexistent/.dockerenv"


def ns(**kw):
    base = dict(host="127.0.0.1", no_browser=False)
    base.update(kw)
    return SimpleNamespace(**base)


@pytest.mark.parametrize("host,ok", [
    ("127.0.0.1", True), ("127.5.5.5", True), ("::1", True), ("[::1]", True),
    ("localhost", True), ("0.0.0.0", False), ("::", False),
    ("192.168.1.5", False), ("example.com", False),
])
def test_is_loopback(host, ok):
    assert is_loopback(host) is ok


def test_browser_opens_by_default_on_loopback():
    assert should_open_browser(ns(), {}, NO_DOCKER) is True


def test_browser_skipped_by_flag_env_host_ci_docker(tmp_path):
    assert should_open_browser(ns(no_browser=True), {}, NO_DOCKER) is False
    assert should_open_browser(ns(), {"SCANLINE_NO_BROWSER": "1"}, NO_DOCKER) is False
    assert should_open_browser(ns(host="0.0.0.0"), {}, NO_DOCKER) is False
    assert should_open_browser(ns(), {"CI": "true"}, NO_DOCKER) is False
    assert should_open_browser(ns(), {"GITHUB_ACTIONS": "true"}, NO_DOCKER) is False
    marker = tmp_path / ".dockerenv"
    marker.write_text("")
    assert in_container_or_ci({}, str(marker)) is True
    assert should_open_browser(ns(), {}, str(marker)) is False


def test_falsey_env_values_do_not_suppress():
    env = {"SCANLINE_NO_BROWSER": "0", "CI": "false"}
    assert should_open_browser(ns(), env, NO_DOCKER) is True


def test_pick_port_free_default():
    assert pick_port("127.0.0.1", 8000, False, is_free=lambda h, p: True) == 8000


def test_pick_port_slides_when_default_busy():
    busy = {8000, 8001}
    assert pick_port("127.0.0.1", 8000, False, is_free=lambda h, p: p not in busy) == 8002


def test_pick_port_explicit_never_moves():
    with pytest.raises(OSError, match="already in use"):
        pick_port("127.0.0.1", 8000, True, is_free=lambda h, p: p != 8000)


def test_pick_port_gives_up_after_ten():
    with pytest.raises(OSError, match="8000 to 8010"):
        pick_port("127.0.0.1", 8000, False, is_free=lambda h, p: False)
    assert pick_port("127.0.0.1", 8000, False, is_free=lambda h, p: p == 8010) == 8010
    with pytest.raises(OSError):
        pick_port("127.0.0.1", 8000, False, is_free=lambda h, p: p == 8011)


def test_pick_port_real_socket():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        s.listen()
        taken = s.getsockname()[1]
        with pytest.raises(OSError):
            pick_port("127.0.0.1", taken, True)


def test_port_explicit_tracking(monkeypatch):
    monkeypatch.delenv("SCANLINE_PORT", raising=False)
    assert parse_args([]).port_explicit is False
    assert parse_args(["--port", "9000"]).port_explicit is True
    monkeypatch.setenv("SCANLINE_PORT", "9100")
    assert parse_args([]).port_explicit is True
    monkeypatch.setenv("SCANLINE_PORT", "junk")
    assert parse_args([]).port_explicit is False


def test_no_browser_flag_parses():
    assert parse_args(["--no-browser"]).no_browser is True
    assert parse_args([]).no_browser is False


def test_open_when_ready_gives_up_quietly():
    calls = []
    # Nothing listens on port 1, so the poll times out and never opens.
    assert _open_when_ready("http://127.0.0.1:1/", timeout=0.3, opener=calls.append) is False
    assert calls == []
