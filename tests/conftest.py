"""Pytest config: register the live marker so live API tests can be selected."""


def pytest_configure(config):
    config.addinivalue_line("markers", "live: hits the real tradingview endpoint over the network")


import pytest


@pytest.fixture(autouse=True)
def _isolate_cookie_config(monkeypatch, tmp_path):
    """Never let a test read or write the developer's real TradingView cookie.

    Real-time mode stores a login credential under the user config dir. A test
    that hit the cookie endpoints without redirecting it once overwrote that
    file, so every test now gets a throwaway config home and a clean env.
    """
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "xdg"))
    monkeypatch.delenv("SCANLINE_TV_SESSIONID", raising=False)
    monkeypatch.delenv("SCANLINE_TV_SESSIONID_SIGN", raising=False)
    from scanline import realtime

    realtime._reset_rejection()
    yield
    realtime._reset_rejection()
