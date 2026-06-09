import time
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8000/"
OUT = Path(__file__).parent

def run(pg, js, wait=1500):
    pg.evaluate(js); pg.wait_for_timeout(wait)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width":1680,"height":1000}, device_scale_factor=2)
    pg.goto(URL, wait_until="networkidle")
    pg.wait_for_selector("#table-host tbody tr", timeout=20000)
    pg.wait_for_timeout(1800)  # let boot finish

    # Full-table mode (rail hidden) with a factor ranking active.
    run(pg, """(async()=>{const s=window.Screener.store;
      s.set({columns:['name','close','change','volume','market_cap_basic','relative_volume_10d_calc','RSI'],
        factor:{weights:[{field:'Perf.1M',weight:1,dir:'high'},{field:'relative_volume_10d_calc',weight:1,dir:'high'},{field:'RSI',weight:0.5,dir:'high'}]}});
      await s.runScreen();
      document.getElementById('app').classList.add('rail-hidden');})()""", 1800)
    pg.screenshot(path=str(OUT/"fulltable.png")); print("fulltable")

    # Column picker open on the Columns tab, searching the full field universe.
    run(pg, """(async()=>{const s=window.Screener.store;
      document.getElementById('app').classList.remove('rail-hidden');
      document.dispatchEvent(new CustomEvent('neon:rail-show',{detail:{tab:'Columns'}}));
      const i=document.querySelector('#column-panel input[placeholder*="Search"]');
      if(i){i.value='margin';i.dispatchEvent(new Event('input',{bubbles:true}));}})()""", 1200)
    pg.screenshot(path=str(OUT/"columns.png")); print("columns")

    # Crypto market.
    run(pg, """(async()=>{const s=window.Screener.store;
      document.dispatchEvent(new CustomEvent('neon:rail-show',{detail:{tab:'Presets'}}));
      await s.setMarket('crypto',['name','close','change','volume','market_cap_calc','Value.Traded']);})()""", 2000)
    pg.screenshot(path=str(OUT/"crypto.png")); print("crypto")

    b.close()
