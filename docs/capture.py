"""Capture README screenshots of the running Neon Screener with headless Chromium.

Run the backend first (python run.py), then: python docs/capture.py
Writes PNGs into docs/.
"""

import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8000/"
OUT = Path(__file__).parent


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1680, "height": 1000}, device_scale_factor=2)
        page.goto(URL, wait_until="networkidle")
        # Wait for the first screen to populate the table.
        page.wait_for_selector("#table-host tbody tr", timeout=20000)
        time.sleep(1.0)

        # Hero shot: default america scan.
        page.screenshot(path=str(OUT / "hero.png"))
        print("wrote hero.png")

        # Apply a factor model via the store so the shot shows the analytics angle.
        page.evaluate(
            """async () => {
              const s = window.Screener.store;
              s.set({
                columns: ['name','close','change','volume','market_cap_basic','relative_volume_10d_calc','RSI'],
                computed: [{id:'dollar_vol', expr:'close*volume'}],
                stats: [{fn:'zscore', field:'change'}],
                factor: {weights:[
                  {field:'Perf.1M', weight:1, dir:'high'},
                  {field:'relative_volume_10d_calc', weight:1, dir:'high'},
                  {field:'RSI', weight:0.5, dir:'high'}
                ]}
              });
              await s.runScreen();
            }"""
        )
        time.sleep(1.5)
        page.screenshot(path=str(OUT / "analytics.png"))
        print("wrote analytics.png")

        # Signals view: the Stacked EMA Fibonacci ribbon with a heatmap on change.
        page.evaluate(
            """async () => {
              const s = window.Screener.store;
              s.set({
                columns: ['name','close','change','EMA8','EMA21','EMA34','EMA55','EMA89'],
                computed: [], stats: [], factor: null,
                filters: [
                  {field:'close', op:'>', value:'EMA8'},
                  {field:'EMA8', op:'>', value:'EMA21'},
                  {field:'EMA21', op:'>', value:'EMA34'},
                  {field:'EMA34', op:'>', value:'EMA55'},
                  {field:'EMA55', op:'>', value:'EMA89'}
                ],
                match: 'all',
                sort: [{field:'change', dir:'desc'}]
              });
              await s.runScreen();
              if (window.Screener.table && window.Screener.table.heatmapCols) {
                window.Screener.table.heatmapCols.add('change');
                window.Screener.table._rerender && window.Screener.table._rerender();
              }
            }"""
        )
        time.sleep(1.5)
        page.screenshot(path=str(OUT / "signals.png"))
        print("wrote signals.png")

        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
