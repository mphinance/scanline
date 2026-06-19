"""The shared screen pipeline.

One pure function, run_screen, that takes a ScreenRequest and returns the
shaped response dict. Both the HTTP API (backend/app.py) and the MCP server
(backend/mcp_server.py) call this so a screen behaves identically no matter
who drives it. Caching lives in the callers, not here.
"""

from __future__ import annotations

import math
import time

from . import analytics
from .fields import default_columns
from .models import ScreenRequest
from .screener import ScreenerError, run_query


def _round_floats(rows: list[dict]) -> list[dict]:
    """Round floats to a reasonable display precision, drop NaN/inf."""
    for row in rows:
        for k, v in row.items():
            if isinstance(v, float):
                if math.isnan(v) or math.isinf(v):
                    row[k] = None
                else:
                    row[k] = round(v, 6)
    return rows


def _query_columns(req: ScreenRequest) -> list[str]:
    """Requested columns plus any base fields stats/factor/sort need to read."""
    base_columns = list(req.columns) or default_columns(req.market)
    needed = set(base_columns)
    for s in req.stats:
        needed.add(s.field)
    if req.factor:
        for w in req.factor.weights:
            needed.add(w.field)
    # Sort on a base (non-derived) field needs that column present too.
    derived_ids = {c.id for c in req.computed} | {"factor_score"}
    for sk in req.sort:
        if sk.field not in derived_ids and not sk.field.startswith(
            ("zscore(", "pctrank(", "rank(", "norm(", "madzscore(")
        ):
            needed.add(sk.field)
    return list(dict.fromkeys([*base_columns, *needed]))


def run_screen(req: ScreenRequest) -> dict:
    """Run the full screen pipeline and return the shaped response dict.

    Shape: {count, rows, columns, meta:{cached, ms, market, error}}. A query
    failure becomes a clean error response, never a raised exception, so every
    caller gets the same contract.
    """
    started = time.time()

    try:
        result = run_query(
            market=req.market,
            columns=_query_columns(req),
            filters=[f.model_dump() for f in req.filters],
            match=req.match,
            sort=[s.model_dump() for s in req.sort] or None,
            limit=req.limit,
            offset=req.offset,
        )
    except ScreenerError as exc:
        return {
            "count": 0,
            "rows": [],
            "columns": [],
            "meta": {
                "cached": False,
                "ms": int((time.time() - started) * 1000),
                "market": req.market,
                "error": str(exc),
            },
        }

    rows = result["rows"]

    # Analytics pipeline over the returned rows.
    if req.computed:
        rows = analytics.apply_computed(rows, [c.model_dump() for c in req.computed])
    if req.stats:
        rows = analytics.apply_stats(rows, [s.model_dump() for s in req.stats])

    factor_requested = bool(req.factor and req.factor.weights)
    if factor_requested:
        rows = analytics.apply_factor(rows, [w.model_dump() for w in req.factor.weights])
        # Re-sort by factor_score when the caller gave no explicit sort.
        if not req.sort:
            rows.sort(key=lambda r: r.get("factor_score") or float("-inf"), reverse=True)

    rows = _round_floats(rows)

    # Final ordered column list: query columns, then computed, stats, factor.
    ordered: list[str] = []
    for c in result["columns"]:
        if c not in ordered:
            ordered.append(c)
    for c in req.computed:
        if c.id not in ordered:
            ordered.append(c.id)
    for s in req.stats:
        name = f"{s.fn}({s.field})"
        if name not in ordered:
            ordered.append(name)
    if factor_requested and "factor_score" not in ordered:
        ordered.append("factor_score")

    return {
        "count": result["count"],
        "rows": rows,
        "columns": ordered,
        "meta": {
            "cached": False,
            "ms": int((time.time() - started) * 1000),
            "market": req.market,
            "error": None,
        },
    }
