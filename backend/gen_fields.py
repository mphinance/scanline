"""Generate the complete TradingView field catalog from the live metainfo.

Run once to (re)build fields_all.json: python backend/gen_fields.py
The app loads that JSON at import, so there is no network call at runtime.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import requests

METAINFO = "https://scanner.tradingview.com/america/metainfo"
OUT = Path(__file__).parent / "fields_all.json"

# Map TradingView metainfo types to our compact type system.
TYPE_MAP = {
    "number": "num",
    "num_slice": "num",
    "percent": "pct",
    "price": "price",
    "fundamental_price": "price",
    "text": "str",
    "map": "str",
    "set": "str",
    "interface": "str",
    "bool": "str",
    "time": "str",
    "time-yyyymmdd": "str",
}

# Best-effort group from a field id, so the full set is at least roughly bucketed.
GROUP_HINTS = [
    (re.compile(r"(price_earnings|price_sales|price_book|price_free_cash|enterprise_value|market_cap)", re.I), "Valuation"),
    (re.compile(r"(dividend|dps|payout)", re.I), "Dividends"),
    (re.compile(r"(margin|return_on|roe|roa|roic|profit)", re.I), "Profitability"),
    (re.compile(r"(revenue|income|ebitda|eps|earnings|gross|operating)", re.I), "Income"),
    (re.compile(r"(debt|asset|liabilit|equity|cash|current_ratio|quick_ratio|book)", re.I), "Balance Sheet"),
    (re.compile(r"(RSI|Stoch|MACD|CCI|ADX|Mom|AO|ROC|W\.R|UO|BBPower|Recommend)", re.I), "Oscillators"),
    (re.compile(r"(SMA|EMA|VWMA|VWAP|BB\.|HullMA|Ichimoku|P\.SAR|Pivot)", re.I), "MovingAverages"),
    (re.compile(r"(Volatility|ATR|beta)", re.I), "Volatility"),
    (re.compile(r"(volume|Value\.Traded|float|shares)", re.I), "Volume"),
    (re.compile(r"(Perf|change|gap|premarket|postmarket|High\.|Low\.|price_52)", re.I), "Performance"),
    (re.compile(r"(close|open|high|low|VWAP|typical)", re.I), "Price"),
    (re.compile(r"(sector|industry|country|exchange|type|subtype|name|description|currency)", re.I), "Identity"),
]


def label_for(field_id: str) -> str:
    """Prettify a raw field id into a readable label."""
    base = field_id.replace("|", " ").replace(".", " ").replace("_", " ")
    return " ".join(w.capitalize() if w.islower() else w for w in base.split())


def group_for(field_id: str) -> str:
    for pat, grp in GROUP_HINTS:
        if pat.search(field_id):
            return grp
    return "Other"


def queryable(field_ids: list[str]) -> set[str]:
    """Return the subset of field_ids the scanner will actually SELECT.

    Metainfo lists more fields than are directly selectable, and one bad column
    fails the whole query, so we probe in chunks and bisect failing chunks to
    isolate the good ones.
    """
    from tradingview_screener import Query

    good: set[str] = set()

    def probe(chunk: list[str]) -> None:
        if not chunk:
            return
        try:
            Query().select("name", *chunk).limit(1).get_scanner_data()
            good.update(chunk)
        except Exception:  # noqa: BLE001
            if len(chunk) == 1:
                return  # this single field is not selectable, drop it
            mid = len(chunk) // 2
            probe(chunk[:mid])
            probe(chunk[mid:])

    CHUNK = 80
    for i in range(0, len(field_ids), CHUNK):
        probe(field_ids[i : i + CHUNK])
    return good


def main() -> int:
    r = requests.get(METAINFO, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    r.raise_for_status()
    fields = r.json().get("fields", [])
    candidates = []
    seen = set()
    for f in fields:
        fid = f.get("n")
        if not fid or fid in seen:
            continue
        # Skip interval variants (e.g. "RSI|1W"). The timeframe toggles generate
        # those on demand, so the catalog stays the set of distinct base fields.
        if "|" in fid:
            continue
        seen.add(fid)
        candidates.append(f)

    print(f"probing {len(candidates)} candidate fields for queryability...")
    good = queryable([f["n"] for f in candidates])
    print(f"  {len(good)} of {len(candidates)} are selectable")

    out = []
    for f in candidates:
        fid = f["n"]
        if fid not in good:
            continue
        ttype = TYPE_MAP.get(f.get("t"), "str")
        unit = "%" if ttype == "pct" else ("$" if ttype == "price" else "")
        out.append({
            "id": fid,
            "label": label_for(fid),
            "group": group_for(fid),
            "type": ttype,
            "unit": unit,
        })
    out.sort(key=lambda x: (x["group"], x["label"]))
    OUT.write_text(json.dumps(out, indent=0), encoding="utf-8")
    print(f"wrote {len(out)} queryable fields to {OUT.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
