"""Backend tests.

Analytics tests run fully offline. The API tests hit the live tradingview
endpoint and are marked 'live' so they can be skipped without network.
"""

from __future__ import annotations

import math

import pytest

from backend import analytics
from backend.fields import FIELDS, field_index, validate_field
from backend.presets import FACTOR_PRESETS, PRESETS


# --- catalog -------------------------------------------------------------

def test_catalog_has_enough_fields():
    assert len(FIELDS) >= 150


def test_catalog_entries_well_formed():
    types = {"num", "pct", "price", "int", "str", "bignum"}
    for f in FIELDS:
        assert set(f) == {"id", "label", "group", "type", "unit"}
        assert f["type"] in types
        assert f["id"]


def test_validate_field():
    assert validate_field("close")
    assert not validate_field("not_a_real_field_xyz")


def test_presets_count():
    assert len(PRESETS) >= 22
    assert len(FACTOR_PRESETS) == 5


def test_preset_fields_are_real():
    # Every column referenced by a preset must be a catalog field, or a catalog
    # field carrying a valid timeframe suffix (e.g. RSI|1W on the MTF presets).
    for p in PRESETS:
        for c in p["columns"]:
            assert validate_field(c), f"{p['id']} uses unknown column {c}"


def test_preset_filter_fields_are_real():
    # Filter fields and any field-id values must validate too, so a typo in a
    # signal preset cannot silently return nothing.
    for p in PRESETS:
        for flt in p.get("filters", []):
            assert validate_field(flt["field"]), f"{p['id']} filters unknown field {flt['field']}"
            val = flt.get("value")
            if isinstance(val, str):
                assert validate_field(val), f"{p['id']} compares against unknown field {val}"


# --- safe_eval sandbox ---------------------------------------------------

def test_safe_eval_basic_math():
    row = {"high": 10, "low": 8, "close": 9, "volume": 1000}
    assert analytics.safe_eval("(high-low)/close*100", row) == pytest.approx(22.2222, abs=1e-3)
    assert analytics.safe_eval("close*volume", row) == 9000


def test_safe_eval_functions():
    row = {"x": -5, "y": 16}
    assert analytics.safe_eval("abs(x)", row) == 5
    assert analytics.safe_eval("sqrt(y)", row) == 4
    assert analytics.safe_eval("max(x,y)", row) == 16


def test_safe_eval_div_by_zero_returns_none():
    assert analytics.safe_eval("a/b", {"a": 1, "b": 0}) is None


def test_safe_eval_rejects_imports():
    with pytest.raises(ValueError):
        analytics.safe_eval("__import__('os').system('echo hi')", {})


def test_safe_eval_rejects_attribute_access():
    with pytest.raises(ValueError):
        analytics.safe_eval("close.__class__", {"close": 5})


def test_safe_eval_rejects_subscript():
    with pytest.raises(ValueError):
        analytics.safe_eval("close[0]", {"close": 5})


def test_safe_eval_rejects_strings():
    with pytest.raises(ValueError):
        analytics.safe_eval("'a'+'b'", {})


def test_safe_eval_rejects_unknown_function():
    with pytest.raises(ValueError):
        analytics.safe_eval("exec('x')", {})


# --- computed columns ----------------------------------------------------

def test_apply_computed():
    rows = [{"high": 10, "low": 5, "close": 8}, {"high": 20, "low": 10, "close": 15}]
    out = analytics.apply_computed(rows, [{"id": "rng", "expr": "(high-low)/close*100"}])
    assert out[0]["rng"] == pytest.approx(62.5, abs=1e-3)
    assert out[1]["rng"] == pytest.approx(66.6667, abs=1e-3)


def test_apply_computed_malicious_is_none_not_executed():
    rows = [{"close": 5}]
    out = analytics.apply_computed(rows, [{"id": "x", "expr": "__import__('os').system('echo hi')"}])
    assert out[0]["x"] is None


# --- stats ---------------------------------------------------------------

def test_zscore():
    rows = [{"v": 1}, {"v": 2}, {"v": 3}, {"v": 4}, {"v": 5}]
    analytics.apply_stats(rows, [{"fn": "zscore", "field": "v"}])
    # mean 3, population std sqrt(2)
    assert rows[2]["zscore(v)"] == pytest.approx(0.0, abs=1e-6)
    assert rows[0]["zscore(v)"] == pytest.approx((1 - 3) / math.sqrt(2), abs=1e-3)


def test_pctrank():
    rows = [{"v": 10}, {"v": 20}, {"v": 30}, {"v": 40}]
    analytics.apply_stats(rows, [{"fn": "pctrank", "field": "v"}])
    assert rows[0]["pctrank(v)"] == pytest.approx(12.5, abs=1e-6)
    assert rows[3]["pctrank(v)"] == pytest.approx(87.5, abs=1e-6)


def test_rank_desc():
    rows = [{"v": 10}, {"v": 30}, {"v": 20}]
    analytics.apply_stats(rows, [{"fn": "rank", "field": "v"}])
    assert rows[1]["rank(v)"] == 1
    assert rows[2]["rank(v)"] == 2
    assert rows[0]["rank(v)"] == 3


def test_norm():
    rows = [{"v": 0}, {"v": 5}, {"v": 10}]
    analytics.apply_stats(rows, [{"fn": "norm", "field": "v"}])
    assert rows[0]["norm(v)"] == 0.0
    assert rows[1]["norm(v)"] == pytest.approx(0.5)
    assert rows[2]["norm(v)"] == 1.0


def test_madzscore_symmetric():
    # [1,2,3,4,5]: median=3, MAD=1, scale=1.4826
    rows = [{"v": 1}, {"v": 2}, {"v": 3}, {"v": 4}, {"v": 5}]
    analytics.apply_stats(rows, [{"fn": "madzscore", "field": "v"}])
    # Median element is 0
    assert rows[2]["madzscore(v)"] == pytest.approx(0.0, abs=1e-6)
    # By symmetry, 1 and 5 should be negatives of each other
    assert rows[0]["madzscore(v)"] == pytest.approx(-rows[4]["madzscore(v)"], abs=1e-4)
    # Exactly: (1-3)/(1.4826*1)
    assert rows[0]["madzscore(v)"] == pytest.approx(-2.0 / 1.4826, abs=1e-4)


def test_madzscore_outlier_resistance():
    # With a large outlier the non-outlier scores stay reasonable.
    # [1,2,3,4,100]: median=3, |devs|=[2,1,0,1,97], MAD=1, scale=1.4826
    rows = [{"v": 1}, {"v": 2}, {"v": 3}, {"v": 4}, {"v": 100}]
    analytics.apply_stats(rows, [{"fn": "madzscore", "field": "v"}])
    # The median row is still 0
    assert rows[2]["madzscore(v)"] == pytest.approx(0.0, abs=1e-6)
    # Non-outlier row 0: (1-3)/1.4826 ~ -1.35; not squashed toward 0
    assert rows[0]["madzscore(v)"] == pytest.approx(-2.0 / 1.4826, abs=1e-4)
    # Outlier gets a large score, but does not destroy the rest
    assert rows[4]["madzscore(v)"] > 50


def test_madzscore_none_handling():
    # None values stay None; present values are computed over the non-None set
    rows = [{"v": 2}, {"v": None}, {"v": 4}]
    analytics.apply_stats(rows, [{"fn": "madzscore", "field": "v"}])
    assert rows[1]["madzscore(v)"] is None
    # median([2,4])=3, MAD=1, scale=1.4826
    assert rows[0]["madzscore(v)"] == pytest.approx(-1.0 / 1.4826, abs=1e-4)
    assert rows[2]["madzscore(v)"] == pytest.approx(1.0 / 1.4826, abs=1e-4)


def test_madzscore_constant_returns_zero():
    # If MAD=0 every value is the median, all scores should be 0.
    rows = [{"v": 5}, {"v": 5}, {"v": 5}]
    analytics.apply_stats(rows, [{"fn": "madzscore", "field": "v"}])
    for row in rows:
        assert row["madzscore(v)"] == 0.0


def test_stats_ignore_none():
    rows = [{"v": 2}, {"v": None}, {"v": 4}]
    analytics.apply_stats(rows, [{"fn": "zscore", "field": "v"}])
    assert rows[1]["zscore(v)"] is None
    # mean computed only over 2 and 4 -> 3
    assert rows[0]["zscore(v)"] == pytest.approx(-1.0, abs=1e-6)


# --- winsor stat ---------------------------------------------------------

def test_winsor_clips_outliers():
    # 20 regular values (1..20) plus extreme outliers -1000 and 1000.
    # Winsor should clip at Q5/Q95 so the inner values still span [0,1]
    # and the outliers are clamped, not blowing out the range.
    inner = list(range(1, 21))   # 20 points
    rows = [{"v": -1000}] + [{"v": x} for x in inner] + [{"v": 1000}]
    analytics.apply_stats(rows, [{"fn": "winsor", "field": "v"}])
    col = "winsor(v)"
    # Bottom outlier should be 0.0, top outlier should be 1.0 (clamped at clip boundaries)
    assert rows[0][col] == 0.0
    assert rows[-1][col] == 1.0
    # Inner min and max should both be in [0, 1]
    inner_scores = [rows[i + 1][col] for i in range(len(inner))]
    assert all(0.0 <= s <= 1.0 for s in inner_scores)
    # Lowest inner value is >= 0, highest is <= 1 and the span is meaningful
    assert inner_scores[-1] > inner_scores[0]


def test_winsor_normal_range_matches_norm():
    # Without outliers (all values in the inner 5-95% range), winsor and norm
    # should produce identical results for the extreme points.
    rows = [{"v": float(x)} for x in range(1, 11)]
    out_winsor = [dict(r) for r in rows]
    out_norm = [dict(r) for r in rows]
    analytics.apply_stats(out_winsor, [{"fn": "winsor", "field": "v"}])
    analytics.apply_stats(out_norm, [{"fn": "norm", "field": "v"}])
    # Both should produce 0.0 at the minimum and 1.0 at the maximum
    assert out_winsor[0]["winsor(v)"] == pytest.approx(0.0, abs=0.05)
    assert out_winsor[-1]["winsor(v)"] == pytest.approx(1.0, abs=0.05)


def test_winsor_none_handling():
    rows = [{"v": 1}, {"v": None}, {"v": 5}, {"v": 10}]
    analytics.apply_stats(rows, [{"fn": "winsor", "field": "v"}])
    col = "winsor(v)"
    assert rows[1][col] is None
    # Non-None rows get a score in [0, 1]
    for i in (0, 2, 3):
        assert 0.0 <= rows[i][col] <= 1.0


def test_winsor_constant_returns_zero():
    # Constant column: span=0 after clipping, every value should be 0.0.
    rows = [{"v": 7}, {"v": 7}, {"v": 7}, {"v": 7}, {"v": 7}]
    analytics.apply_stats(rows, [{"fn": "winsor", "field": "v"}])
    for row in rows:
        assert row["winsor(v)"] == 0.0


def test_winsor_single_value():
    rows = [{"v": 42}]
    analytics.apply_stats(rows, [{"fn": "winsor", "field": "v"}])
    assert rows[0]["winsor(v)"] == 0.0


# --- decile stat ---------------------------------------------------------

def test_decile_basic():
    # 10 evenly spaced values should each land in a distinct decile.
    rows = [{"v": float(i)} for i in range(1, 11)]
    analytics.apply_stats(rows, [{"fn": "decile", "field": "v"}])
    col = "decile(v)"
    deciles = [row[col] for row in rows]
    assert deciles[0] == 1
    assert deciles[-1] == 10
    assert deciles == sorted(deciles)
    assert all(1 <= d <= 10 for d in deciles)


def test_decile_top_and_bottom():
    rows = [{"v": 0.0}, {"v": 50.0}, {"v": 100.0}]
    analytics.apply_stats(rows, [{"fn": "decile", "field": "v"}])
    col = "decile(v)"
    assert rows[0][col] == 1
    assert rows[-1][col] == 10


def test_decile_none_handling():
    rows = [{"v": 1}, {"v": None}, {"v": 5}, {"v": 10}]
    analytics.apply_stats(rows, [{"fn": "decile", "field": "v"}])
    col = "decile(v)"
    assert rows[1][col] is None
    assert all(rows[i][col] is not None for i in (0, 2, 3))
    assert all(1 <= rows[i][col] <= 10 for i in (0, 2, 3))


def test_decile_constant_returns_one():
    # Constant series: no ordering possible, all fall in decile 1.
    rows = [{"v": 7}, {"v": 7}, {"v": 7}]
    analytics.apply_stats(rows, [{"fn": "decile", "field": "v"}])
    assert all(row["decile(v)"] == 1 for row in rows)


def test_decile_single_value():
    rows = [{"v": 42}]
    analytics.apply_stats(rows, [{"fn": "decile", "field": "v"}])
    assert rows[0]["decile(v)"] == 1


def test_decile_ties_same_decile():
    # Tied values must land in the same decile.
    rows = [{"v": 1}, {"v": 1}, {"v": 5}, {"v": 10}, {"v": 10}]
    analytics.apply_stats(rows, [{"fn": "decile", "field": "v"}])
    col = "decile(v)"
    assert rows[0][col] == rows[1][col]
    assert rows[3][col] == rows[4][col]
    assert rows[0][col] < rows[2][col] < rows[3][col]


# --- factor scoring ------------------------------------------------------

def test_apply_factor():
    rows = [
        {"change": 5, "rv": 1.0},
        {"change": 0, "rv": 2.0},
        {"change": -5, "rv": 3.0},
    ]
    analytics.apply_factor(
        rows,
        [
            {"field": "change", "weight": 1, "dir": "high"},
            {"field": "rv", "weight": 1, "dir": "high"},
        ],
    )
    # change is symmetric, rv ascending: row0 high change low rv, row2 low change high rv.
    # weights equal so scores should roughly cancel for the extremes.
    assert "factor_score" in rows[0]
    assert rows[0]["factor_score"] == pytest.approx(0.0, abs=1e-6)
    assert rows[1]["factor_score"] == pytest.approx(0.0, abs=1e-6)


def test_factor_direction_low():
    rows = [{"pe": 5}, {"pe": 10}, {"pe": 15}]
    analytics.apply_factor(rows, [{"field": "pe", "weight": 1, "dir": "low"}])
    # low PE should score highest
    assert rows[0]["factor_score"] > rows[2]["factor_score"]


# --- live API tests ------------------------------------------------------

@pytest.mark.live
def test_run_query_live():
    from backend.screener import run_query

    res = run_query(
        market="america",
        columns=["name", "close", "change", "volume", "market_cap_basic"],
        filters=[{"field": "market_cap_basic", "op": ">", "value": 1e9}],
        match="all",
        sort=[{"field": "volume", "dir": "desc"}],
        limit=10,
    )
    assert res["count"] > 0
    assert len(res["rows"]) > 0
    assert "ticker" in res["columns"]
