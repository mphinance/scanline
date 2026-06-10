"""NEON SCREENER as an MCP server.

Exposes the exact same screen engine the web app uses (backend/pipeline.py)
over the Model Context Protocol, so any MCP client (Claude Desktop, Claude
Code, etc.) can drive the screener directly: filter, score, rank, and discover
fields across stocks, crypto, forex, futures, bonds, and CFDs.

No TradingView account needed. Data is live and delayed, same as the web app.

Run it:
    python -m backend.mcp_server              # stdio (Claude Desktop / Code)
    python -m backend.mcp_server --http 8765  # streamable-http on a port

Design notes, informed by the existing TradingView MCP servers:
  - One unified `screen` tool (our backend already spans 6 markets) plus preset
    and factor-preset runners, rather than a tool per asset class.
  - `search_fields` makes the 1000+ field universe discoverable to the model,
    the API twin of the web app's column picker.
  - Cross-field filters work out of the box: a filter value may be another
    field id, e.g. {"field":"SMA50","op":"crosses_above","value":"SMA200"}.
  - A short TTL cache in front of the engine softens TradingView's rate-limit
    cliff under bursty agent use, and `server_stats` reports on it.
"""

from __future__ import annotations

import sys
import time
from typing import Any

from fastmcp import FastMCP

from .cache import TTLCache, make_key
from .fields import CURATED_IDS, FIELDS, field_index, validate_field
from .models import (
    Computed,
    Factor,
    FactorWeight,
    Filter,
    ScreenRequest,
    SortKey,
    Stat,
)
from .pipeline import run_screen
from .presets import FACTOR_PRESETS, PRESETS
from .screener import MARKETS

mcp = FastMCP("neon-screener")

# Resilience + a tiny bit of self-awareness for the stats tool.
_cache = TTLCache(ttl_seconds=20)
_STATS = {"calls": 0, "cache_hits": 0, "errors": 0, "started": time.time()}

# Operator reference, kept in lockstep with backend/screener._apply_op. The
# `value` column notes when a value may be another field id (cross-field).
OPERATORS: list[dict] = [
    {"op": ">", "value": "number or field id", "desc": "greater than"},
    {"op": ">=", "value": "number or field id", "desc": "greater than or equal"},
    {"op": "<", "value": "number or field id", "desc": "less than"},
    {"op": "<=", "value": "number or field id", "desc": "less than or equal"},
    {"op": "==", "value": "number, string, or field id", "desc": "equal"},
    {"op": "!=", "value": "number, string, or field id", "desc": "not equal"},
    {"op": "between", "value": "[low, high]", "desc": "inclusive range"},
    {"op": "not_between", "value": "[low, high]", "desc": "outside a range"},
    {"op": "above_pct", "value": "[field id, fraction]", "desc": "within fraction below a field, e.g. close above_pct [price_52_week_high, 0.95]"},
    {"op": "below_pct", "value": "[field id, fraction]", "desc": "within fraction above a field"},
    {"op": "crosses", "value": "number or field id", "desc": "crossed in either direction this bar"},
    {"op": "crosses_above", "value": "number or field id", "desc": "crossed up through (golden-cross style)"},
    {"op": "crosses_below", "value": "number or field id", "desc": "crossed down through (death-cross style)"},
    {"op": "isin", "value": "[v1, v2, ...]", "desc": "value is one of"},
    {"op": "not_in", "value": "[v1, v2, ...]", "desc": "value is none of"},
    {"op": "in_day_range", "value": "[low, high]", "desc": "today's range overlaps"},
    {"op": "in_week_range", "value": "[low, high]", "desc": "this week's range overlaps"},
    {"op": "in_month_range", "value": "[low, high]", "desc": "this month's range overlaps"},
    {"op": "like", "value": "substring", "desc": "text contains"},
    {"op": "not_like", "value": "substring", "desc": "text does not contain"},
    {"op": "empty", "value": "(none)", "desc": "field has no value"},
    {"op": "not_empty", "value": "(none)", "desc": "field has a value"},
]


# Friendly chart intervals mapped to TradingView interval codes. The values are
# exactly what the TradingView chart URL and the advanced-chart widget accept.
_INTERVALS: dict[str, str] = {
    "1m": "1", "1": "1", "1min": "1",
    "5m": "5", "5": "5",
    "15m": "15", "15": "15",
    "30m": "30", "30": "30",
    "1h": "60", "60": "60", "hourly": "60",
    "2h": "120", "120": "120",
    "4h": "240", "240": "240",
    "1d": "D", "d": "D", "day": "D", "daily": "D",
    "1w": "W", "w": "W", "week": "W", "weekly": "W",
    "1mo": "M", "m": "M", "month": "M", "monthly": "M",
}


def normalize_interval(value: str) -> str:
    """Map a friendly interval ("4h", "daily", "1W") to a TradingView code."""
    return _INTERVALS.get(str(value).strip().lower(), "D")


# TradingView's Recommend.* gauges are floats in [-1, 1]. These are the same
# bands the TradingView UI uses for its Strong Buy / Buy / Neutral / ... label.
def rating_label(score: float | None) -> str:
    """Map a Recommend.* score to its TradingView text rating."""
    if score is None:
        return "Unknown"
    if score >= 0.5:
        return "Strong Buy"
    if score >= 0.1:
        return "Buy"
    if score > -0.1:
        return "Neutral"
    if score > -0.5:
        return "Sell"
    return "Strong Sell"


def _resolve_row(symbol: str, market: str, columns: list[str]) -> dict | None:
    """Fetch one row by ticker symbol (case-insensitive on `name`)."""
    cols = [c for c in columns if validate_field(c)] or ["name"]
    req = ScreenRequest(
        market=market,
        filters=[Filter(field="name", op="==", value=symbol.upper())],
        columns=cols,
        limit=1,
    )
    resp = run_screen(req)
    rows = resp.get("rows") or []
    return rows[0] if rows else None


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
def _render_table(columns: list[str], rows: list[dict], max_rows: int = 50) -> str:
    """Render rows as an aligned monospace table, token-efficient for the model."""
    if not rows:
        return "(no rows)"
    cols = columns or list(rows[0].keys())
    shown = rows[:max_rows]

    def cell(v: Any) -> str:
        if v is None:
            return ""
        if isinstance(v, float):
            return f"{v:,.4g}" if abs(v) < 1e6 else f"{v:,.0f}"
        return str(v)

    widths = {c: len(c) for c in cols}
    table_cells = []
    for r in shown:
        row_cells = {c: cell(r.get(c)) for c in cols}
        for c in cols:
            widths[c] = max(widths[c], len(row_cells[c]))
        table_cells.append(row_cells)

    header = "  ".join(c.ljust(widths[c]) for c in cols)
    sep = "  ".join("-" * widths[c] for c in cols)
    body = "\n".join(
        "  ".join(rc[c].ljust(widths[c]) for c in cols) for rc in table_cells
    )
    extra = f"\n... {len(rows) - max_rows} more rows" if len(rows) > max_rows else ""
    return f"{header}\n{sep}\n{body}{extra}"


def _shape(resp: dict, table_rows: int = 50) -> dict:
    """Add a rendered table and a one-line summary to a pipeline response."""
    meta = resp.get("meta", {})
    if meta.get("error"):
        _STATS["errors"] += 1
        return {
            "error": meta["error"],
            "market": meta.get("market"),
            "count": 0,
            "rows": [],
        }
    rows, columns = resp["rows"], resp["columns"]
    return {
        "count": resp["count"],
        "returned": len(rows),
        "market": meta.get("market"),
        "ms": meta.get("ms"),
        "columns": columns,
        "rows": rows,
        "table": _render_table(columns, rows, max_rows=table_rows),
    }


def _run(req: ScreenRequest, table_rows: int = 50) -> dict:
    """Run a screen through the cache and shape it for the model."""
    _STATS["calls"] += 1
    key = make_key(req.model_dump())
    cached = _cache.get(key)
    if cached is not None:
        _STATS["cache_hits"] += 1
        return _shape(cached, table_rows)
    resp = run_screen(req)
    if resp["meta"].get("error") is None:
        _cache.set(key, resp)
    return _shape(resp, table_rows)


# ----------------------------------------------------------------------------
# Discovery tools
# ----------------------------------------------------------------------------
@mcp.tool
def list_markets() -> list[dict]:
    """List the markets the screener can target.

    Returns each market's id (use as the `market` arg elsewhere), a label, and
    its kind. Covers US stocks, crypto, forex, futures, bonds, and CFDs.
    """
    return MARKETS


@mcp.tool
def search_fields(query: str = "", group: str = "", limit: int = 40) -> dict:
    """Search the TradingView field universe (1000+ fields) by id, label, or group.

    This is how you discover what you can filter, sort, and select on. The
    curated set (price, performance, valuation, profitability, dividends,
    technicals, moving averages, oscillators, volume, volatility) leads; every
    other queryable base field is reachable too.

    query: case-insensitive substring matched against field id and label.
    group: optional exact group filter, e.g. "Oscillators", "Valuation".
    Returns {count, fields:[{id,label,group,type,unit,curated}]}.
    """
    q = query.strip().lower()
    g = group.strip().lower()
    out: list[dict] = []
    for f in FIELDS:
        if g and f["group"].lower() != g:
            continue
        if q and q not in f["id"].lower() and q not in f["label"].lower():
            continue
        out.append({**f, "curated": f["id"] in CURATED_IDS})
        if len(out) >= max(1, limit):
            break
    return {"count": len(out), "fields": out}


@mcp.tool
def list_operators() -> list[dict]:
    """List the filter operators, what value each expects, and what it means.

    Note the cross-field operators: a value may be another field id, so
    {"field":"SMA50","op":"crosses_above","value":"SMA200"} is a golden cross
    and {"field":"close","op":">","value":"VWAP"} is price over VWAP.
    """
    return OPERATORS


@mcp.tool
def list_presets(group: str = "") -> list[dict]:
    """List the one-click preset scans (id, name, description, market, group).

    47 presets across general scans and the SIGNALS / MOMENTUM / TREND /
    MULTI-TIMEFRAME signal groups. Pass `group` to filter, e.g. "Momentum".
    Run one with `run_preset`.
    """
    g = group.strip().lower()
    out = []
    for p in PRESETS:
        if g and p.get("group", "").lower() != g:
            continue
        out.append(
            {
                "id": p["id"],
                "name": p["name"],
                "description": p["description"],
                "market": p["market"],
                "group": p.get("group", "General"),
            }
        )
    return out


@mcp.tool
def list_factor_presets() -> list[dict]:
    """List the composite factor-scoring presets (Momentum, Value, Quality, ...).

    Each is a weighted, direction-aware blend of fields. Run one with
    `run_factor_preset` to rank a market by that factor.
    """
    return [
        {"id": fp["id"], "name": fp["name"], "weights": fp["weights"]}
        for fp in FACTOR_PRESETS
    ]


# ----------------------------------------------------------------------------
# The core screen tool
# ----------------------------------------------------------------------------
@mcp.tool
def screen(
    market: str = "america",
    filters: list[dict] | None = None,
    columns: list[str] | None = None,
    match: str = "all",
    sort: list[dict] | None = None,
    computed: list[dict] | None = None,
    stats: list[dict] | None = None,
    factor: list[dict] | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """Run a live market screen and return the matching rows.

    This is the full engine the web app uses, including the analytics layer that
    makes this more than a filter.

    market:  one of list_markets() ids (america, crypto, forex, futures, bond, cfd).
    filters: list of {"field","op","value"}. See list_operators(). Values may be
             numbers, strings, lists, or another field id (cross-field). Example:
             [{"field":"market_cap_basic","op":">","value":1e9},
              {"field":"RSI","op":"<","value":30}]
    columns: field ids to select (see search_fields). Defaults to a sensible set.
    match:   "all" (AND) or "any" (OR) across filters.
    sort:    list of {"field","dir"} with dir "asc"|"desc". First key is applied
             server-side; you may sort by a computed/stat/factor column too.
    computed: derived columns via a sandboxed expression engine, e.g.
             [{"id":"dollar_vol","expr":"close*volume"},
              {"id":"range_pct","expr":"(high-low)/close*100"}].
             Operators + - * / % ** and abs min max round sqrt log ln floor ceil.
    stats:   in-result statistics computed across the returned set, e.g.
             [{"fn":"zscore","field":"change"},{"fn":"pctrank","field":"volume"}].
             fn is one of zscore | pctrank | rank | norm. Column name is "fn(field)".
    factor:  composite factor score: list of {"field","weight","dir"} with dir
             "high"|"low". Adds a "factor_score" column and ranks by it when no
             explicit sort is given.
    limit:   max rows (default 50). offset: skip N rows for paging.

    Returns {count, returned, market, ms, columns, rows, table}. `count` is the
    full universe size matching the filters; `rows` is the page you asked for.
    """
    factor_model = None
    if factor:
        factor_model = Factor(weights=[FactorWeight(**w) for w in factor])
    req = ScreenRequest(
        market=market,
        filters=[Filter(**f) for f in (filters or [])],
        columns=columns or [],
        match=match,
        sort=[SortKey(**s) for s in (sort or [])],
        computed=[Computed(**c) for c in (computed or [])],
        stats=[Stat(**s) for s in (stats or [])],
        factor=factor_model,
        limit=limit,
        offset=offset,
    )
    return _run(req, table_rows=min(limit, 50))


@mcp.tool
def run_preset(preset_id: str, limit: int = 50) -> dict:
    """Run a named preset scan (see list_presets) and return its rows.

    The preset supplies the market, filters, columns, and sort. `limit` caps
    the rows returned.
    """
    preset = next((p for p in PRESETS if p["id"] == preset_id), None)
    if preset is None:
        return {"error": f"Unknown preset: {preset_id}. See list_presets()."}
    req = ScreenRequest(
        market=preset["market"],
        filters=[Filter(**f) for f in preset.get("filters", [])],
        columns=preset.get("columns", []),
        match=preset.get("match", "all"),
        sort=[SortKey(**s) for s in preset.get("sort", [])],
        limit=limit,
    )
    return _run(req, table_rows=min(limit, 50))


@mcp.tool
def run_factor_preset(
    factor_preset_id: str,
    market: str = "america",
    filters: list[dict] | None = None,
    columns: list[str] | None = None,
    limit: int = 50,
) -> dict:
    """Rank a market by a named composite factor (see list_factor_presets).

    Applies the factor's weighted, direction-aware z-score blend, adds a
    "factor_score" column, and ranks by it. Narrow the universe first with
    `filters` (recommended, e.g. a market-cap floor) so the ranking is over a
    meaningful set.
    """
    fp = next((f for f in FACTOR_PRESETS if f["id"] == factor_preset_id), None)
    if fp is None:
        return {"error": f"Unknown factor preset: {factor_preset_id}. See list_factor_presets()."}
    req = ScreenRequest(
        market=market,
        filters=[Filter(**f) for f in (filters or [])],
        columns=columns or [],
        factor=Factor(weights=[FactorWeight(**w) for w in fp["weights"]]),
        limit=limit,
    )
    return _run(req, table_rows=min(limit, 50))


@mcp.tool
def lookup_symbol(ticker: str, market: str = "america", columns: list[str] | None = None) -> dict:
    """Fetch one symbol's row by ticker (e.g. "NVDA", "BTCUSD").

    Matches case-insensitively on the `name` field. Returns the single row with
    the requested columns (or a broad default set), or an error if not found.
    """
    cols = columns or [
        "name", "description", "close", "change", "volume", "market_cap_basic",
        "RSI", "Perf.1M", "Perf.YTD", "price_earnings_ttm", "sector",
    ]
    cols = [c for c in cols if c in field_index]
    req = ScreenRequest(
        market=market,
        filters=[Filter(field="name", op="==", value=ticker.upper())],
        columns=cols,
        limit=1,
    )
    out = _run(req, table_rows=1)
    if out.get("rows"):
        return {"symbol": ticker.upper(), "market": market, "row": out["rows"][0], "table": out["table"]}
    if out.get("error"):
        return out
    return {"error": f"No symbol '{ticker.upper()}' found in market '{market}'."}


@mcp.tool
def server_stats() -> dict:
    """Report screener MCP server health: calls served, cache hit rate, errors.

    A self-monitoring tool, handy for confirming the cache is doing its job and
    that upstream calls are healthy.
    """
    uptime = time.time() - _STATS["started"]
    calls = _STATS["calls"]
    return {
        "uptime_seconds": int(uptime),
        "screen_calls": calls,
        "cache_hits": _STATS["cache_hits"],
        "cache_hit_rate": round(_STATS["cache_hits"] / calls, 3) if calls else 0.0,
        "errors": _STATS["errors"],
        "cache_ttl_seconds": _cache.ttl,
        "fields_indexed": len(FIELDS),
        "presets": len(PRESETS),
        "factor_presets": len(FACTOR_PRESETS),
        "markets": len(MARKETS),
    }


# ----------------------------------------------------------------------------
# Symbol intelligence: search, compare, rate, and read a chart
# ----------------------------------------------------------------------------
@mcp.tool
def search_symbols(query: str, market: str = "america", limit: int = 20) -> dict:
    """Find symbols by ticker or company name (substring, case-insensitive).

    Resolves "apple" or "nvda" to real rows so you can hand a ticker to the
    other tools. Matches the `name` and `description` fields. Returns
    {count, symbols:[{ticker,name,description,close,change,sector,market_cap_basic}]}.
    """
    q = query.strip()
    if not q:
        return {"count": 0, "symbols": []}
    cols = ["name", "description", "close", "change", "sector", "market_cap_basic"]
    cols = [c for c in cols if c in field_index]
    req = ScreenRequest(
        market=market,
        filters=[
            Filter(field="name", op="like", value=q),
            Filter(field="description", op="like", value=q),
        ],
        match="any",
        columns=cols,
        sort=[SortKey(field="market_cap_basic", dir="desc")] if "market_cap_basic" in field_index else [],
        limit=limit,
    )
    out = _run(req, table_rows=limit)
    if out.get("error"):
        return out
    return {"count": out["count"], "symbols": out["rows"], "table": out.get("table")}


@mcp.tool
def compare(tickers: list[str], columns: list[str] | None = None, market: str = "america") -> dict:
    """Put several symbols side by side on the same columns.

    tickers: e.g. ["NVDA","AMD","AVGO"]. columns defaults to a broad price +
    performance + valuation set. Returns the aligned rows and a rendered table.
    """
    syms = [t.upper() for t in (tickers or []) if t]
    if not syms:
        return {"error": "Pass at least one ticker."}
    cols = columns or [
        "name", "close", "change", "Perf.1M", "Perf.YTD", "RSI",
        "market_cap_basic", "price_earnings_ttm", "Recommend.All",
    ]
    cols = [c for c in cols if validate_field(c)]
    req = ScreenRequest(
        market=market,
        filters=[Filter(field="name", op="isin", value=syms)],
        columns=cols,
        limit=max(len(syms), 1),
    )
    return _run(req, table_rows=len(syms))


@mcp.tool
def technical_rating(ticker: str, market: str = "america", timeframes: list[str] | None = None) -> dict:
    """TradingView's own technical rating gauge for a symbol.

    Returns the overall, moving-average, and oscillator ratings (Strong Buy /
    Buy / Neutral / Sell / Strong Sell), optionally across several timeframes.

    timeframes: any of "1m","5m","15m","1h","4h","1d","1w","1mo" (default "1d").
    """
    tfs = timeframes or ["1d"]
    base = ["Recommend.All", "Recommend.MA", "Recommend.Other"]
    # Build the suffixed column set. Daily uses the bare field; others get |code.
    wanted = ["name", "description", "close", "change"]
    tf_cols: dict[str, dict] = {}
    for tf in tfs:
        code = normalize_interval(tf)
        suffix = "" if code == "D" else f"|{code}"
        tf_cols[tf] = {b: f"{b}{suffix}" for b in base}
        wanted += list(tf_cols[tf].values())
    row = _resolve_row(ticker, market, wanted)
    if row is None:
        return {"error": f"No symbol '{ticker.upper()}' in market '{market}'."}

    ratings = {}
    for tf, cols in tf_cols.items():
        ratings[tf] = {
            "overall": rating_label(row.get(cols["Recommend.All"])),
            "moving_averages": rating_label(row.get(cols["Recommend.MA"])),
            "oscillators": rating_label(row.get(cols["Recommend.Other"])),
            "score": row.get(cols["Recommend.All"]),
        }
    return {
        "ticker": row.get("name", ticker.upper()),
        "description": row.get("description"),
        "close": row.get("close"),
        "change": row.get("change"),
        "ratings": ratings,
    }


# Multi-timeframe ladder. Each entry is (label, suffix-code). Daily is the bare
# field; the others carry the |code suffix the scanner accepts. All probed live.
_TIMEFRAMES = [("1h", "60"), ("4h", "240"), ("1d", "D"), ("1w", "1W"), ("1m", "1M")]


def _tf_field(base: str, code: str) -> str:
    """RSI, "D" -> "RSI"; RSI, "240" -> "RSI|240"."""
    return base if code == "D" else f"{base}|{code}"


# Columns the chart-read pulls. Daily-centric trend/range/rating fields, plus the
# RSI and MACD across every timeframe so the read is multi-timeframe in one shot,
# no chart swapping. Fields that do not populate for a market simply drop out.
_READ_COLUMNS = [
    "name", "description", "close", "change", "sector",
    "RSI", "MACD.macd", "MACD.signal", "Stoch.K", "Stoch.D",
    "ADX", "ADX+DI", "ADX-DI", "AO", "CCI20", "W.R",
    "EMA8", "EMA21", "SMA20", "SMA50", "SMA200",
    "price_52_week_high", "price_52_week_low",
    "Perf.W", "Perf.1M", "Perf.YTD", "relative_volume_10d_calc", "Volatility.D",
    "Recommend.All", "Recommend.MA", "Recommend.Other",
] + [
    _tf_field(b, code)
    for _lbl, code in _TIMEFRAMES
    for b in ("RSI", "MACD.macd", "MACD.signal")
]


@mcp.tool
def analyze(ticker: str, market: str = "america") -> dict:
    """Read a symbol's chart: a structured, multi-timeframe technical analysis.

    Composes TradingView's own fields into trend, momentum, range, and rating
    reads plus a list of plain-language signals, so an agent can narrate "what
    the chart is saying" without eyeballing it. The read is multi-timeframe in a
    single call: RSI and MACD bias on the 1h, 4h, 1d, 1w, and 1m at once, with an
    alignment verdict, so nobody has to swap timeframes. Pure TradingView data.

    Returns {ticker, close, change, trend, momentum, multi_timeframe, range,
    rating, performance, signals[], summary}.
    """
    row = _resolve_row(ticker, market, _READ_COLUMNS)
    if row is None:
        return {"error": f"No symbol '{ticker.upper()}' in market '{market}'."}

    g = row.get
    signals: list[str] = []

    def above(a, b):
        return g(a) is not None and g(b) is not None and g(a) > g(b)

    # ---- Trend: price versus the moving-average stack.
    close = g("close")
    ma_pos = {}
    for ma in ("SMA20", "SMA50", "SMA200"):
        if close is not None and g(ma) is not None:
            ma_pos[ma] = "above" if close > g(ma) else "below"
    if ma_pos and all(v == "above" for v in ma_pos.values()):
        signals.append("Price above all major moving averages")
    elif ma_pos and all(v == "below" for v in ma_pos.values()):
        signals.append("Price below all major moving averages")
    golden = above("SMA50", "SMA200")
    if g("SMA50") is not None and g("SMA200") is not None:
        signals.append("SMA50 above SMA200 (golden-cross stack)" if golden
                       else "SMA50 below SMA200 (death-cross stack)")
    adx = g("ADX")
    if adx is not None:
        di_bull = above("ADX+DI", "ADX-DI")
        strength = "strong" if adx >= 25 else "weak"
        direction = "up" if di_bull else "down"
        trend_label = f"{strength} {direction}trend (ADX {adx:.0f})"
        if adx >= 25:
            signals.append(f"ADX {adx:.0f}: strong { 'up' if di_bull else 'down' }trend")
    else:
        trend_label = None
    ema_fast = "EMA8 above EMA21 (fast bull)" if above("EMA8", "EMA21") else None
    if ema_fast:
        signals.append(ema_fast)

    trend = {
        "vs_moving_averages": ma_pos,
        "golden_cross_stack": golden if (g("SMA50") is not None and g("SMA200") is not None) else None,
        "ema_fast_bull": above("EMA8", "EMA21") if (g("EMA8") is not None and g("EMA21") is not None) else None,
        "adx": adx,
        "label": trend_label,
    }

    # ---- Momentum: RSI / MACD / Stochastic.
    rsi = g("RSI")
    rsi_state = None
    if rsi is not None:
        if rsi >= 70:
            rsi_state = "overbought"; signals.append(f"RSI {rsi:.0f}: overbought")
        elif rsi <= 30:
            rsi_state = "oversold"; signals.append(f"RSI {rsi:.0f}: oversold")
        elif rsi >= 50:
            rsi_state = "bullish"
        else:
            rsi_state = "bearish"
    macd_bull = above("MACD.macd", "MACD.signal")
    if g("MACD.macd") is not None and g("MACD.signal") is not None:
        signals.append("MACD above signal (bullish)" if macd_bull else "MACD below signal (bearish)")
    stoch_bull = above("Stoch.K", "Stoch.D")
    momentum = {
        "rsi": rsi,
        "rsi_state": rsi_state,
        "rsi_weekly": g("RSI|1W"),
        "macd_bullish": macd_bull if (g("MACD.macd") is not None and g("MACD.signal") is not None) else None,
        "stochastic_bullish": stoch_bull if (g("Stoch.K") is not None and g("Stoch.D") is not None) else None,
    }

    # ---- Range: position within the 52-week band.
    hi, lo = g("price_52_week_high"), g("price_52_week_low")
    rng = {}
    if close is not None and hi is not None and lo is not None and hi > lo:
        pct_from_high = (close - hi) / hi * 100.0
        pct_off_low = (close - lo) / lo * 100.0
        pos = (close - lo) / (hi - lo) * 100.0
        rng = {
            "high_52w": hi, "low_52w": lo,
            "pct_from_high": round(pct_from_high, 2),
            "pct_off_low": round(pct_off_low, 2),
            "position_in_range": round(pos, 1),
        }
        if pct_from_high >= -3:
            signals.append("Within 3% of the 52-week high")
        if pct_off_low <= 3:
            signals.append("Within 3% of the 52-week low")

    # ---- Multi-timeframe: RSI + MACD bias on every timeframe at once.
    timeframes: dict[str, dict] = {}
    bull_tfs, bear_tfs = [], []
    for lbl, code in _TIMEFRAMES:
        tf_rsi = g(_tf_field("RSI", code))
        tf_macd = g(_tf_field("MACD.macd", code))
        tf_sig = g(_tf_field("MACD.signal", code))
        if tf_rsi is None and tf_macd is None:
            continue
        rsi_bull = tf_rsi is not None and tf_rsi > 50
        macd_bull = (tf_macd is not None and tf_sig is not None and tf_macd > tf_sig)
        if tf_rsi is not None and tf_macd is not None and tf_sig is not None:
            bias = "bull" if (rsi_bull and macd_bull) else "bear" if (not rsi_bull and not macd_bull) else "mixed"
        elif tf_rsi is not None:
            bias = "bull" if rsi_bull else "bear"
        else:
            bias = "bull" if macd_bull else "bear"
        if bias == "bull":
            bull_tfs.append(lbl)
        elif bias == "bear":
            bear_tfs.append(lbl)
        timeframes[lbl] = {
            "rsi": tf_rsi,
            "macd_bullish": macd_bull if (tf_macd is not None and tf_sig is not None) else None,
            "bias": bias,
        }

    graded = [tf for tf in timeframes.values() if tf["bias"] in ("bull", "bear")]
    if graded and all(tf["bias"] == "bull" for tf in graded):
        alignment = "fully aligned bullish"
        signals.append(f"Aligned bullish across all timeframes ({', '.join(bull_tfs)})")
    elif graded and all(tf["bias"] == "bear" for tf in graded):
        alignment = "fully aligned bearish"
        signals.append(f"Aligned bearish across all timeframes ({', '.join(bear_tfs)})")
    elif graded:
        alignment = f"mixed ({len(bull_tfs)} bull, {len(bear_tfs)} bear)"
    else:
        alignment = "unknown"
    multi_timeframe = {"alignment": alignment, "bullish": bull_tfs, "bearish": bear_tfs, "by_timeframe": timeframes}

    rating = {
        "overall": rating_label(g("Recommend.All")),
        "moving_averages": rating_label(g("Recommend.MA")),
        "oscillators": rating_label(g("Recommend.Other")),
        "score": g("Recommend.All"),
    }

    performance = {k: g(v) for k, v in (("week", "Perf.W"), ("month", "Perf.1M"), ("ytd", "Perf.YTD")) if g(v) is not None}

    summary = (
        f"{row.get('name', ticker.upper())} at {close}: {rating['overall']} overall. "
        f"{trend_label or 'trend n/a'}; "
        f"RSI {('%.0f' % rsi) if rsi is not None else 'n/a'}"
        f"{f' ({rsi_state})' if rsi_state else ''}; "
        f"MACD {'bullish' if macd_bull else 'bearish'}; "
        f"timeframes {alignment}."
    )

    return {
        "ticker": row.get("name", ticker.upper()),
        "description": row.get("description"),
        "market": market,
        "close": close,
        "change": row.get("change"),
        "trend": trend,
        "momentum": momentum,
        "multi_timeframe": multi_timeframe,
        "range": rng,
        "rating": rating,
        "performance": performance,
        "signals": signals,
        "summary": summary,
    }


@mcp.tool
def chart(ticker: str, market: str = "america", interval: str = "1d", theme: str = "dark") -> dict:
    """Get a live TradingView chart for a symbol: deep link + embeddable widget.

    Resolves the symbol to its exchange-prefixed ticker, then returns a chart
    URL plus a ready-to-paste TradingView Advanced Chart widget (config + HTML).
    Pure TradingView. interval accepts "1m".."1mo" friendly forms; theme is
    "dark" or "light".

    Returns {symbol, interval, chart_url, widget:{script,config}, embed_html}.
    """
    row = _resolve_row(ticker, market, ["name", "description"])
    full = (row or {}).get("ticker") or ticker.upper()
    code = normalize_interval(interval)
    chart_url = f"https://www.tradingview.com/chart/?symbol={full}&interval={code}"
    config = {
        "symbol": full,
        "interval": code,
        "theme": "dark" if theme != "light" else "light",
        "style": "1",
        "autosize": True,
        "studies": ["RSI@tv-basicstudies", "MASimple@tv-basicstudies"],
        "allow_symbol_change": True,
    }
    script = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js"
    import json as _json
    embed_html = (
        '<div class="tradingview-widget-container">'
        '<div class="tradingview-widget-container__widget"></div>'
        f'<script type="text/javascript" src="{script}" async>'
        f"{_json.dumps(config)}"
        "</script></div>"
    )
    return {
        "symbol": full,
        "description": (row or {}).get("description"),
        "interval": code,
        "chart_url": chart_url,
        "widget": {"type": "advanced-chart", "script": script, "config": config},
        "embed_html": embed_html,
    }


@mcp.tool
def sector_breakdown(market: str = "america", filters: list[dict] | None = None, limit: int = 500) -> dict:
    """Aggregate a screen by sector: count, average change, and total market cap.

    A bird's-eye read of where the money and the moves are right now. Aggregates
    over the returned set (apply `filters` to scope it, e.g. a market-cap floor).
    Returns sectors sorted by total market cap.
    """
    req = ScreenRequest(
        market=market,
        filters=[Filter(**f) for f in (filters or [])],
        columns=["name", "sector", "change", "market_cap_basic"],
        limit=limit,
    )
    resp = run_screen(req)
    if resp["meta"].get("error"):
        _STATS["errors"] += 1
        return {"error": resp["meta"]["error"]}
    buckets: dict[str, dict] = {}
    for r in resp["rows"]:
        sec = r.get("sector") or "Unknown"
        b = buckets.setdefault(sec, {"count": 0, "changes": [], "mcap": 0.0})
        b["count"] += 1
        if isinstance(r.get("change"), (int, float)):
            b["changes"].append(r["change"])
        if isinstance(r.get("market_cap_basic"), (int, float)):
            b["mcap"] += r["market_cap_basic"]
    sectors = []
    for sec, b in buckets.items():
        changes = b["changes"]
        sectors.append({
            "sector": sec,
            "count": b["count"],
            "avg_change": round(sum(changes) / len(changes), 3) if changes else None,
            "total_market_cap": round(b["mcap"], 0),
        })
    sectors.sort(key=lambda s: s["total_market_cap"], reverse=True)
    return {"sampled": len(resp["rows"]), "universe": resp["count"], "sectors": sectors}


# ----------------------------------------------------------------------------
# Prompts: canned, modern screening workflows the model can launch
# ----------------------------------------------------------------------------
@mcp.prompt
def momentum_breakouts(market: str = "america") -> str:
    """Find and read the strongest momentum breakouts right now."""
    return (
        f"Use the neon-screener tools on the {market} market. Run the "
        "`signal_volume_breakout` and `signal_stacked_ema_ribbon` presets via "
        "run_preset, then for the top 3 names call `analyze` to read each chart. "
        "Summarize which look like the cleanest breakouts and why, citing the "
        "rating, trend, and the 52-week position."
    )


@mcp.prompt
def oversold_quality(market: str = "america") -> str:
    """Hunt for oversold names that are still high quality."""
    return (
        "Screen for oversold-but-quality candidates: run a `screen` on "
        f"{market} with RSI < 35 and return_on_equity > 15 and market_cap_basic "
        "> 2e9, ranked by RSI ascending. Then `analyze` the top few and flag any "
        "where the weekly RSI is still bullish (a pullback in an uptrend)."
    )


@mcp.prompt
def rank_by_factor(factor: str = "momentum", market: str = "america") -> str:
    """Rank a market by a composite factor and read the leaders."""
    return (
        f"Call run_factor_preset with factor_preset_id='{factor}' on the {market} "
        "market and a market_cap_basic > 1e10 filter. Take the top 5 by "
        "factor_score, then `analyze` each and tell me which leader has the "
        "strongest technical confirmation."
    )


@mcp.prompt
def read_symbol(ticker: str) -> str:
    """Give a full plain-language chart read for one symbol."""
    return (
        f"Call `analyze` for {ticker}, then `technical_rating` across the 1d, 1w, "
        "and 1mo timeframes, and `chart` for a link. Write a tight chart read: "
        "trend, momentum, key levels, multi-timeframe rating, and a final stance."
    )


# ----------------------------------------------------------------------------
# Resources: catalogs the model can read wholesale
# ----------------------------------------------------------------------------
@mcp.resource("screener://fields")
def fields_resource() -> dict:
    """The full field catalog (id, label, group, type, unit)."""
    return {"count": len(FIELDS), "fields": FIELDS}


@mcp.resource("screener://presets")
def presets_resource() -> dict:
    """Every preset scan and factor preset, in full."""
    return {"presets": PRESETS, "factor_presets": FACTOR_PRESETS}


@mcp.resource("screener://operators")
def operators_resource() -> list[dict]:
    """The filter operator reference."""
    return OPERATORS


def main() -> None:
    """Entry point. Default stdio; `--http PORT` for streamable-http."""
    args = sys.argv[1:]
    if "--http" in args:
        i = args.index("--http")
        port = int(args[i + 1]) if i + 1 < len(args) else 8765
        mcp.run(transport="http", port=port)
    else:
        mcp.run()


if __name__ == "__main__":
    main()
