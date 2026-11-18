import io
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8000/"
OUT = Path(__file__).parent / "boot.gif"
FRAMES = 30
TARGET_W = 860

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 1280, "height": 760}, device_scale_factor=1)
    pg.goto(URL, wait_until="networkidle")
    pg.wait_for_selector("#table-host tbody tr", timeout=20000)
    pg.wait_for_timeout(2000)  # let the first boot + data fully settle

    # Re-arm the boot: restart every body.booting animation from 0%.
    pg.evaluate("""() => {
      const bd = document.body;
      bd.classList.remove('booting');
      void bd.offsetWidth;              // force reflow so animations restart
      // boot element resets its sweep too
      const boot = document.getElementById('boot');
      if (boot) { boot.style.animation = 'none'; void boot.offsetWidth; boot.style.animation = ''; }
      bd.classList.add('booting');
    }""")

    frames = []
    for _ in range(FRAMES):
        png = pg.screenshot(type="png")
        frames.append(Image.open(io.BytesIO(png)).convert("RGB"))
        pg.wait_for_timeout(18)  # small gap; screenshot latency spaces the rest

    pg.evaluate("() => document.body.classList.remove('booting')")
    # one clean settled frame, held at the end
    pg.wait_for_timeout(150)
    settled = Image.open(io.BytesIO(pg.screenshot(type="png"))).convert("RGB")
    b.close()

# Downscale and quantize for a reasonable GIF size.
def prep(img):
    w, h = img.size
    nh = int(h * TARGET_W / w)
    return img.resize((TARGET_W, nh), Image.LANCZOS).quantize(colors=128, dither=Image.Dither.NONE)

seq = [prep(f) for f in frames] + [prep(settled)] * 14  # hold the final look
seq[0].save(
    OUT, save_all=True, append_images=seq[1:],
    duration=70, loop=0, optimize=True, disposal=2,
)
kb = OUT.stat().st_size / 1024
print(f"wrote {OUT.name} ({len(seq)} frames, {kb:.0f} KB)")
