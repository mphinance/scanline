"""MCP server tests.

The discovery tools and resources run fully offline (they read the catalog and
preset tables, no network). The screen path is marked 'live' since it hits the
real tradingview endpoint. Each test drives the server through fastmcp's
in-memory Client, exactly as a real MCP client would.
"""

from __future__ import annotations

import asyncio

import pytest
from fastmcp import Client

from backend.mcp_server import (
    _compute_breadth,
    _compute_sector_rotation,
    mcp,
    normalize_interval,
    rating_label,
)


def _call(name: str, args: dict | None = None):
    """Run one MCP tool call through an in-memory client and return its data."""

    async def run():
        async with Client(mcp) as c:
            res = await c.call_tool(name, args or {})
            return res.data

    return asyncio.run(run())


def _list():
    async def run():
        async with Client(mcp) as c:
            tools = [t.name for t in await c.list_tools()]
            resources = [str(r.uri) for r in await c.list_resources()]
            prompts = [p.name for p in await c.list_prompts()]
            return tools, resources, prompts

    return asyncio.run(run())


# --- wiring --------------------------------------------------------------

def test_tools_and_resources_registered():
    tools, resources, prompts = _list()
    expected_tools = {
        "list_markets", "search_fields", "list_operators", "list_presets",
        "list_factor_presets", "screen", "run_preset", "run_factor_preset",
        "lookup_symbol", "server_stats",
        # Wave 2: symbol intelligence.
        "search_symbols", "compare", "technical_rating", "analyze", "chart",
        "sector_breakdown",
        # Nightly 2026-06-22: top movers.
        "top_movers",
        # Nightly 2026-06-23: market breadth.
        "market_breadth",
        # Nightly 2026-06-24: sector rotation.
        "sector_rotation",
    }
    assert expected_tools <= set(tools)
    assert {"screener://fields", "screener://presets", "screener://operators"} <= set(resources)
    assert {"momentum_breakouts", "oversold_quality", "rank_by_factor", "read_symbol"} <= set(prompts)


# --- Wave 2 pure helpers (offline) --------------------------------------

def test_rating_label_bands():
    assert rating_label(0.7) == "Strong Buy"
    assert rating_label(0.2) == "Buy"
    assert rating_label(0.0) == "Neutral"
    assert rating_label(-0.3) == "Sell"
    assert rating_label(-0.8) == "Strong Sell"
    assert rating_label(None) == "Unknown"


def test_normalize_interval():
    assert normalize_interval("4h") == "240"
    assert normalize_interval("1h") == "60"
    assert normalize_interval("daily") == "D"
    assert normalize_interval("1W") == "W"
    assert normalize_interval("weekly") == "W"
    assert normalize_interval("nonsense") == "D"


# --- discovery (offline) -------------------------------------------------

def test_list_markets():
    markets = _call("list_markets")
    ids = {m["id"] for m in markets}
    assert {"america", "crypto", "forex", "futures", "bond", "cfd"} <= ids


def test_search_fields_finds_rsi():
    out = _call("search_fields", {"query": "rsi", "limit": 10})
    ids = {f["id"] for f in out["fields"]}
    assert "RSI" in ids
    assert out["count"] <= 10
    assert all("curated" in f for f in out["fields"])


def test_search_fields_group_filter():
    out = _call("search_fields", {"group": "Oscillators", "limit": 100})
    assert out["count"] > 0
    assert all(f["group"] == "Oscillators" for f in out["fields"])


def test_list_operators_includes_cross_field():
    ops = {o["op"] for o in _call("list_operators")}
    assert {"crosses_above", "crosses_below", "between", "above_pct"} <= ops


def test_list_presets_and_group_filter():
    allp = _call("list_presets")
    assert len(allp) >= 22
    momentum = _call("list_presets", {"group": "Momentum"})
    assert len(momentum) > 0
    assert all(p["group"] == "Momentum" for p in momentum)


def test_list_factor_presets():
    fps = _call("list_factor_presets")
    ids = {f["id"] for f in fps}
    assert {"momentum", "value", "quality", "growth", "low_vol"} <= ids


def test_server_stats_shape():
    s = _call("server_stats")
    assert s["markets"] == 6
    assert s["fields_indexed"] > 150
    assert "cache_hit_rate" in s


# --- error paths (offline) ----------------------------------------------

def test_run_preset_unknown_id():
    out = _call("run_preset", {"preset_id": "does_not_exist"})
    assert "error" in out


def test_run_factor_preset_unknown_id():
    out = _call("run_factor_preset", {"factor_preset_id": "does_not_exist"})
    assert "error" in out


# --- live screen path ----------------------------------------------------

@pytest.mark.live
def test_screen_live_with_analytics():
    out = _call("screen", {
        "market": "america",
        "filters": [{"field": "market_cap_basic", "op": ">", "value": 1e10}],
        "columns": ["name", "close", "change", "volume"],
        "computed": [{"id": "dollar_vol", "expr": "close*volume"}],
        "stats": [{"fn": "zscore", "field": "change"}],
        "sort": [{"field": "volume", "dir": "desc"}],
        "limit": 5,
    })
    assert out["count"] > 0
    assert out["returned"] <= 5
    assert "dollar_vol" in out["columns"]
    assert "zscore(change)" in out["columns"]
    assert out["table"]


@pytest.mark.live
def test_lookup_symbol_live():
    out = _call("lookup_symbol", {"ticker": "AAPL"})
    assert out.get("row", {}).get("name") == "AAPL"


@pytest.mark.live
def test_search_symbols_live():
    out = _call("search_symbols", {"query": "apple", "limit": 5})
    names = {s.get("name") for s in out["symbols"]}
    assert "AAPL" in names


@pytest.mark.live
def test_compare_live():
    out = _call("compare", {"tickers": ["NVDA", "AMD"]})
    names = {r.get("name") for r in out["rows"]}
    assert {"NVDA", "AMD"} <= names


@pytest.mark.live
def test_technical_rating_live():
    out = _call("technical_rating", {"ticker": "AAPL", "timeframes": ["1d"]})
    assert "1d" in out["ratings"]
    assert out["ratings"]["1d"]["overall"] in {
        "Strong Buy", "Buy", "Neutral", "Sell", "Strong Sell", "Unknown",
    }


@pytest.mark.live
def test_analyze_multi_timeframe_live():
    out = _call("analyze", {"ticker": "AAPL"})
    assert out["summary"]
    mtf = out["multi_timeframe"]
    assert "alignment" in mtf
    # At least the daily and weekly timeframes should populate.
    assert {"1d", "1w"} <= set(mtf["by_timeframe"].keys())
    for tf in mtf["by_timeframe"].values():
        assert tf["bias"] in {"bull", "bear", "mixed"}


@pytest.mark.live
def test_chart_resolves_ticker_live():
    out = _call("chart", {"ticker": "NVDA", "interval": "4h"})
    assert out["symbol"] == "NASDAQ:NVDA"
    assert out["interval"] == "240"
    assert out["chart_url"].startswith("https://www.tradingview.com/chart/")
    assert "embed-widget-advanced-chart.js" in out["embed_html"]


# --- top_movers (offline wiring + live data) ----------------------------

def test_top_movers_is_registered():
    tools, _, _ = _list()
    assert "top_movers" in tools


@pytest.mark.live
def test_top_movers_live():
    out = _call("top_movers", {"market": "america", "n": 5})
    assert "gainers" in out
    assert "losers" in out
    assert len(out["gainers"]) <= 5
    assert len(out["losers"]) <= 5
    assert out["gainers_table"]
    assert out["losers_table"]
    # Gainers should be sorted descending by change.
    changes = [r.get("change") for r in out["gainers"] if r.get("change") is not None]
    assert changes == sorted(changes, reverse=True)
    # Losers should be sorted ascending.
    changes_l = [r.get("change") for r in out["losers"] if r.get("change") is not None]
    assert changes_l == sorted(changes_l)


@pytest.mark.live
def test_top_movers_with_filter_live():
    out = _call("top_movers", {
        "market": "america",
        "n": 3,
        "filters": [{"field": "market_cap_basic", "op": ">", "value": 1e10}],
    })
    assert "gainers" in out and "losers" in out
    assert out["universe"] > 0


# --- market_breadth (offline wiring + math + live data) -----------------

def test_market_breadth_is_registered():
    tools, _, _ = _list()
    assert "market_breadth" in tools


def test_compute_breadth_basic():
    rows = [
        {"close": 10, "change": 2.0,  "RSI": 65, "SMA50": 9,  "SMA200": 8},
        {"close": 20, "change": -1.0, "RSI": 28, "SMA50": 22, "SMA200": 18},
        {"close": 30, "change": 0.0,  "RSI": 55, "SMA50": 28, "SMA200": 25},
        {"close": 40, "change": 3.0,  "RSI": 72, "SMA50": 35, "SMA200": 30},
    ]
    b = _compute_breadth(rows)
    assert b["sample"] == 4
    assert b["advancers"] == 2
    assert b["decliners"] == 1
    assert b["unchanged"] == 1
    assert b["ad_ratio"] == pytest.approx(2.0)
    assert b["pct_advancers"] == pytest.approx(50.0)
    assert b["pct_decliners"] == pytest.approx(25.0)
    # Row0 close(10) > SMA50(9), Row2 close(30) > SMA50(28), Row3 close(40) > SMA50(35)
    # Row1 close(20) < SMA50(22)  -> 3/4 above = 75%
    assert b["pct_above_sma50"] == pytest.approx(75.0)
    # All rows have close > SMA200 -> 100%
    assert b["pct_above_sma200"] == pytest.approx(100.0)
    # RSI: 65, 28, 55, 72  -> avg = (65+28+55+72)/4 = 55.0
    assert b["avg_rsi"] == pytest.approx(55.0)
    # Overbought (>=70): row3(72) -> 1/4 = 25%
    assert b["pct_rsi_overbought"] == pytest.approx(25.0)
    # Oversold (<=30): row1(28) -> 1/4 = 25%
    assert b["pct_rsi_oversold"] == pytest.approx(25.0)


def test_compute_breadth_empty():
    b = _compute_breadth([])
    assert b == {"sample": 0}


def test_compute_breadth_no_decliners():
    # ad_ratio is None when there are no decliners.
    rows = [{"close": 5, "change": 1.0, "RSI": 60, "SMA50": 4, "SMA200": 3}]
    b = _compute_breadth(rows)
    assert b["decliners"] == 0
    assert b["ad_ratio"] is None
    assert b["advancers"] == 1


def test_compute_breadth_missing_fields():
    # Rows without SMA50/SMA200/RSI should produce None for those metrics.
    rows = [{"close": 10, "change": 1.0}, {"close": 20, "change": -1.0}]
    b = _compute_breadth(rows)
    assert b["pct_above_sma50"] is None
    assert b["pct_above_sma200"] is None
    assert b["avg_rsi"] is None


@pytest.mark.live
def test_market_breadth_live():
    out = _call("market_breadth", {"market": "america", "limit": 200})
    assert out.get("market") == "america"
    assert out.get("universe", 0) > 0
    assert out["sample"] <= 200
    assert out["advancers"] + out["decliners"] + out["unchanged"] == out["sample"]
    assert 0 <= out["pct_advancers"] <= 100
    assert 0 <= out["pct_decliners"] <= 100
    # With a broad US scan, SMA data should be present.
    assert out["pct_above_sma50"] is not None
    assert out["pct_above_sma200"] is not None


@pytest.mark.live
def test_market_breadth_with_filter_live():
    out = _call("market_breadth", {
        "market": "america",
        "filters": [{"field": "market_cap_basic", "op": ">", "value": 1e10}],
        "limit": 100,
    })
    assert "sample" in out
    assert out["sample"] > 0


# --- sector_rotation (offline math + live data) --------------------------

def test_sector_rotation_is_registered():
    tools, _, _ = _list()
    assert "sector_rotation" in tools


def test_compute_sector_rotation_basic():
    rows = [
        {"sector": "Tech",    "change": 2.0,  "Perf.1M": 5.0,  "Perf.YTD": 20.0, "RSI": 60, "market_cap_basic": 1e12},
        {"sector": "Tech",    "change": 3.0,  "Perf.1M": 7.0,  "Perf.YTD": 25.0, "RSI": 65, "market_cap_basic": 5e11},
        {"sector": "Energy",  "change": -1.0, "Perf.1M": -2.0, "Perf.YTD": -5.0, "RSI": 40, "market_cap_basic": 3e11},
        {"sector": "Health",  "change": 0.5,  "Perf.1M": 1.0,  "Perf.YTD": 8.0,  "RSI": 52, "market_cap_basic": 2e11},
    ]
    result = _compute_sector_rotation(rows)
    secs = {s["sector"]: s for s in result}

    # Three sectors present.
    assert len(result) == 3
    assert set(secs) == {"Tech", "Energy", "Health"}

    # Tech should have the highest momentum_score.
    assert result[0]["sector"] == "Tech"
    # Energy (negative across all timeframes) should be last.
    assert result[-1]["sector"] == "Energy"

    # Per-sector averages.
    import pytest as _pt
    assert secs["Tech"]["avg_change"] == _pt.approx(2.5, abs=1e-3)
    assert secs["Tech"]["avg_perf_1m"] == _pt.approx(6.0, abs=1e-3)
    assert secs["Tech"]["count"] == 2

    # momentum_score is in [0, 1].
    for s in result:
        if s["momentum_score"] is not None:
            assert 0.0 <= s["momentum_score"] <= 1.0

    # Best scorer is 1.0 or close; worst is 0.0 or close.
    assert result[0]["momentum_score"] == _pt.approx(1.0, abs=1e-6)
    assert result[-1]["momentum_score"] == _pt.approx(0.0, abs=1e-6)


def test_compute_sector_rotation_empty():
    result = _compute_sector_rotation([])
    assert result == []


def test_compute_sector_rotation_missing_perf_fields():
    # Rows without Perf.1M and Perf.YTD: score is based on avg_change only.
    rows = [
        {"sector": "Tech",   "change": 3.0,  "RSI": 65},
        {"sector": "Energy", "change": -1.0, "RSI": 40},
    ]
    result = _compute_sector_rotation(rows)
    secs = {s["sector"]: s for s in result}

    assert secs["Tech"]["avg_perf_1m"] is None
    assert secs["Tech"]["avg_perf_ytd"] is None
    # Scoring should still work using avg_change alone.
    assert result[0]["sector"] == "Tech"
    assert result[0]["momentum_score"] == 1.0
    assert result[1]["momentum_score"] == 0.0


def test_compute_sector_rotation_single_sector():
    # Only one sector: normalization undefined, momentum_score is None.
    rows = [
        {"sector": "Tech", "change": 2.0, "Perf.1M": 5.0, "Perf.YTD": 20.0, "RSI": 60},
        {"sector": "Tech", "change": 3.0, "Perf.1M": 7.0, "Perf.YTD": 25.0, "RSI": 65},
    ]
    result = _compute_sector_rotation(rows)
    assert len(result) == 1
    # Single sector cannot be normalized against others, score is None.
    assert result[0]["momentum_score"] is None


def test_compute_sector_rotation_unknown_sector():
    # Rows without a sector field land in "Unknown".
    rows = [
        {"change": 1.0, "Perf.1M": 2.0, "Perf.YTD": 5.0},
        {"sector": None, "change": -1.0},
    ]
    result = _compute_sector_rotation(rows)
    secs = {s["sector"]: s for s in result}
    assert "Unknown" in secs
    assert secs["Unknown"]["count"] == 2


def test_compute_sector_rotation_sorted_desc():
    rows = [
        {"sector": "A", "change": 5.0,  "Perf.1M": 10.0, "Perf.YTD": 30.0},
        {"sector": "B", "change": 2.0,  "Perf.1M": 4.0,  "Perf.YTD": 10.0},
        {"sector": "C", "change": -2.0, "Perf.1M": -5.0, "Perf.YTD": -10.0},
    ]
    result = _compute_sector_rotation(rows)
    scores = [s["momentum_score"] for s in result if s["momentum_score"] is not None]
    assert scores == sorted(scores, reverse=True)


@pytest.mark.live
def test_sector_rotation_live():
    out = _call("sector_rotation", {"market": "america", "limit": 500})
    assert out.get("market") == "america"
    assert out.get("universe", 0) > 0
    assert out["sampled"] <= 500
    sects = out["sectors"]
    assert len(sects) > 3
    # Each sector has required fields.
    for s in sects:
        assert "sector" in s
        assert "count" in s
        assert "avg_change" in s
        assert "momentum_score" in s
    # Sorted desc by momentum_score (None values trailing).
    scores = [s["momentum_score"] for s in sects]
    non_null = [v for v in scores if v is not None]
    assert non_null == sorted(non_null, reverse=True)


@pytest.mark.live
def test_sector_rotation_with_filter_live():
    out = _call("sector_rotation", {
        "market": "america",
        "filters": [{"field": "market_cap_basic", "op": ">", "value": 1e9}],
        "limit": 300,
    })
    assert "sectors" in out
    assert out["sampled"] > 0
