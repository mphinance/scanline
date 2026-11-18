"""Failure visibility at launch, binary readiness, and earnings time boundaries.

All I/O is replaced: no binary, browser, server, or vendor request is started.
"""

import importlib.util
import logging
import urllib.error
import webbrowser
import zoneinfo
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from scanline import cli, mcp_server


@pytest.mark.parametrize("error", [urllib.error.URLError("not ready"), TimeoutError("timed out")])
def test_browser_readiness_retry_warns(monkeypatch, caplog, error):
    response = Mock()
    response.__enter__ = Mock(return_value=SimpleNamespace(status=200))
    response.__exit__ = Mock(return_value=False)
    request = Mock(side_effect=[error, response])
    monkeypatch.setattr(cli.urllib.request, "urlopen", request)
    monkeypatch.setattr(cli.time, "sleep", lambda _: None)
    opener = Mock()
    with caplog.at_level(logging.WARNING):
        assert cli._open_when_ready("http://127.0.0.1:8000/", opener=opener)
    assert str(error) in caplog.text
    assert "Browser auto-open attempt failed" in caplog.text
    assert request.call_count == 2
    opener.assert_called_once_with("http://127.0.0.1:8000/")


def test_optional_browser_failure_warns(monkeypatch, caplog):
    response = Mock()
    response.__enter__ = Mock(return_value=SimpleNamespace(status=200))
    response.__exit__ = Mock(return_value=False)
    monkeypatch.setattr(cli.urllib.request, "urlopen", Mock(return_value=response))
    ticks = iter([0, 0, 2])
    monkeypatch.setattr(cli.time, "monotonic", lambda: next(ticks))
    monkeypatch.setattr(cli.time, "sleep", lambda _: None)
    with caplog.at_level(logging.WARNING):
        assert not cli._open_when_ready(
            "http://127.0.0.1:8000/", timeout=1,
            opener=Mock(side_effect=webbrowser.Error("browser unavailable")),
        )
    assert "browser unavailable" in caplog.text


@pytest.mark.parametrize("source", ["request", "browser"])
def test_unexpected_browser_startup_errors_propagate(monkeypatch, source):
    response = Mock()
    response.__enter__ = Mock(return_value=SimpleNamespace(status=200))
    response.__exit__ = Mock(return_value=False)
    error = RuntimeError("unexpected startup failure")
    request = Mock(side_effect=error) if source == "request" else Mock(return_value=response)
    opener = Mock(side_effect=error) if source == "browser" else Mock()
    monkeypatch.setattr(cli.urllib.request, "urlopen", request)
    with pytest.raises(RuntimeError, match="unexpected startup failure"):
        cli._open_when_ready("http://127.0.0.1:8000/", opener=opener)


@pytest.fixture
def smoke(monkeypatch):
    path = Path(__file__).resolve().parents[1] / "packaging" / "smoke.py"
    spec = importlib.util.spec_from_file_location("scanline_binary_smoke", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module.sys, "argv", [str(path), "unused-test-binary"])
    process = Mock()
    process.poll.return_value = None
    monkeypatch.setattr(module.subprocess, "Popen", Mock(return_value=process))
    monkeypatch.setattr(module.time, "sleep", lambda _: None)
    return module, process


def test_smoke_readiness_retry_warns(smoke, monkeypatch, caplog, capsys):
    module, process = smoke
    get = Mock(side_effect=[urllib.error.URLError("not listening"), 200, 200, 200])
    monkeypatch.setattr(module, "get", get)
    with caplog.at_level(logging.WARNING):
        assert module.main() == 0
    assert "Health check failed" in caplog.text
    assert "not listening" in caplog.text
    assert "smoke ok" in capsys.readouterr().out
    process.kill.assert_called_once()
    process.wait.assert_called_once()


def test_smoke_unexpected_error_propagates_and_cleans_up(smoke, monkeypatch):
    module, process = smoke
    monkeypatch.setattr(module, "get", Mock(side_effect=RuntimeError("broken health check")))
    with pytest.raises(RuntimeError, match="broken health check"):
        module.main()
    process.kill.assert_called_once()
    process.wait.assert_called_once()


@pytest.mark.parametrize("error", [
    zoneinfo.ZoneInfoNotFoundError("America/New_York unavailable"),
    RuntimeError("unexpected timezone failure"),
])
@pytest.mark.parametrize("operation", [mcp_server._market_today, lambda: mcp_server._days_to_earnings(1787774400)])
def test_earnings_timezone_errors_do_not_fall_back(monkeypatch, error, operation):
    monkeypatch.setattr(zoneinfo, "ZoneInfo", Mock(side_effect=error))
    with pytest.raises(type(error), match=str(error).strip("'")):
        operation()
