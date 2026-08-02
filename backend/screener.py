"""Service wrapper over the tradingview-screener package.

Builds a Query from a structured request, translates op strings to column
operators, runs it, and returns json-safe records. All upstream calls are
wrapped so a failure becomes a clean ScreenerError, never a 500 stacktrace.
"""

from __future__ import annotations

import math
from typing import Any

from tradingview_screener import (
    Query,
    bond,
    cfd,
    col,
    crypto,
    forex,
    futures,
    stocks,
)

from .fields import default_columns, validate_field

# Each market maps to the package helper that configures the correct upstream
# scan context. set_markets('crypto') returns 0 rows for several markets, so we
# start from these pre-configured Query builders instead.
_MARKET_QUERY = {
    "america": lambda: stocks("america"),
    "crypto": crypto,
    "forex": forex,
    "futures": futures,
    "bond": bond,
    "cfd": cfd,
}


def _base_query(market: str) -> Query:
    """Return a fresh Query already scoped to the given market."""
    factory = _MARKET_QUERY.get(market)
    if factory is None:
        raise ScreenerError(f"Unknown market: {market}")
    return factory()

# Markets the screener can target.
MARKETS: list[dict] = [
    {"id": "america", "label": "US Stocks", "kind": "stocks"},
    {"id": "crypto", "label": "Crypto", "kind": "crypto"},
    {"id": "forex", "label": "Forex", "kind": "forex"},
    {"id": "futures", "label": "Futures", "kind": "futures"},
    {"id": "bond", "label": "Bonds", "kind": "bond"},
    {"id": "cfd", "label": "CFD", "kind": "cfd"},
]

_MARKET_IDS = {m["id"] for m in MARKETS}


class ScreenerError(Exception):
    """Clean, user-facing error from the screener service."""


# Operators that take a single comparison value.
def _apply_op(c, op: str, value: Any):
    """Translate an op string plus value into a column condition."""
    if op == ">":
        return c > value
    if op == ">=":
        return c >= value
    if op == "<":
        return c < value
    if op == "<=":
        return c <= value
    if op in ("==", "="):
        return c == value
    if op == "!=":
        return c != value
    if op == "between":
        a, b = value
        return c.between(a, b)
    if op == "not_between":
        a, b = value
        return c.not_between(a, b)
    if op == "above_pct":
        return c.above_pct(value)
    if op == "below_pct":
        return c.below_pct(value)
    if op == "crosses":
        return c.crosses(value)
    if op == "crosses_above":
        return c.crosses_above(value)
    if op == "crosses_below":
        return c.crosses_below(value)
    if op == "isin":
        return c.isin(value)
    if op == "not_in":
        return c.not_in(value)
    if op == "in_day_range":
        a, b = value
        return c.in_day_range(a, b)
    if op == "in_week_range":
        a, b = value
        return c.in_week_range(a, b)
    if op == "in_month_range":
        a, b = value
        return c.in_month_range(a, b)
    if op == "like":
        return c.like(value)
    if op == "not_like":
        return c.not_like(value)
    if op == "empty":
        return c.empty()
    if op == "not_empty":
        return c.not_empty()
    raise ScreenerError(f"Unsupported operator: {op}")


def _build_conditions(filters: list[dict]):
    """Turn filter dicts into a list of column conditions."""
    conds = []
    for filt in filters or []:
        field = filt.get("field")
        op = filt.get("op", ">")
        value = filt.get("value")
        if not field:
            raise ScreenerError("Filter missing field")
        conds.append(_apply_op(col(field), op, value))
    return conds


def _json_safe(value: Any) -> Any:
    """Replace NaN/inf with None so the payload serializes cleanly."""
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
    return value


def run_query(
    market: str = "america",
    columns: list[str] | None = None,
    filters: list[dict] | None = None,
    match: str = "all",
    sort: list[dict] | None = None,
    limit: int = 150,
    offset: int = 0,
) -> dict:
    """Run a screener query and return {count, rows, columns}.

    'ticker' and 'name' are always selected. Sorting is applied server-side
    from the first sort key. Raises ScreenerError on any failure.
    """
    if market not in _MARKET_IDS:
        raise ScreenerError(f"Unknown market: {market}")

    columns = list(columns) if columns else default_columns(market)

    # Drop ids that are not in the catalog so a typo cannot blow up the query.
    columns = [c for c in columns if validate_field(c)]
    if not columns:
        columns = default_columns(market)

    # Always include name; ticker is added automatically by the package.
    select_cols: list[str] = []
    for c in ["name", *columns]:
        if c not in select_cols:
            select_cols.append(c)

    try:
        conds = _build_conditions(filters)
    except ScreenerError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ScreenerError(f"Bad filter: {exc}") from exc

    try:
        q = _base_query(market).select(*select_cols)

        # The market helpers come pre-loaded with the constraints that DEFINE
        # the market: stocks('america') carries is_primary == true in `filter`,
        # plus the instrument type constraints in `filter2`. Both Query.where()
        # and Query.where2() ASSIGN rather than append:
        #
        #     def where(self, *expressions):
        #         self.query['filter'] = list(expressions)
        #
        # so adding any condition of our own silently wiped them out. A single
        # trivially true filter (close > -1e12) took america from 7,648 rows to
        # 13,374 by readmitting every non-primary listing, which means every
        # preset and every filtered tool has been scanning a different, much
        # dirtier universe than the unfiltered default view. Compose with the
        # market's own constraints instead of replacing them.
        base_filter = list(q.query.get("filter") or [])
        base_filter2 = q.query.get("filter2")

        if conds:
            if match == "any" and len(conds) > 1:
                from tradingview_screener import Or

                combined = Or(*conds)
                # filter2 is {"operator": "and", "operands": [{"operation":...}]}
                # and Or() returns exactly that operand shape, so the market's
                # type constraints survive alongside ours.
                if isinstance(base_filter2, dict) and base_filter2.get("operator") == "and":
                    base_filter2.setdefault("operands", []).append(combined)
                else:
                    q = q.where2(combined)
                if base_filter:
                    q = q.where(*base_filter)
            else:
                q = q.where(*base_filter, *conds)

        if sort:
            first = sort[0]
            field = first.get("field")
            ascending = first.get("dir", "desc") != "desc"
            if field and validate_field(field):
                q = q.order_by(field, ascending=ascending)

        q = q.offset(max(0, offset)).limit(max(1, limit))

        count, df = q.get_scanner_data()
    except ScreenerError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ScreenerError(f"Screener query failed: {exc}") from exc

    # DataFrame -> json-safe records.
    records: list[dict] = []
    df_cols = list(df.columns)
    for raw in df.to_dict("records"):
        records.append({k: _json_safe(v) for k, v in raw.items()})

    return {"count": int(count), "rows": records, "columns": df_cols}
