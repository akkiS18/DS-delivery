"""Builds the DS print designs: python docs/print/ds-reklama/build.py

1. Makes assets/logo-white.png and assets/logo-color.png (transparent) from docs/play-store/feature-graphic-1024x500.png.
2. Renders each page with headless Chrome to out/<name>.png (300 dpi, with bleed) and out/<name>.pdf (vector, for the printer).
Needs Pillow and Google Chrome; the pages load qrcode-generator from cdnjs, so it needs internet.
"""
import math, pathlib, subprocess, sys, tempfile
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parents[2]
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PAGES = [  # name, width mm, height mm (with bleed), bleed mm
    ("tent", 106, 216, 3),
    ("card-front", 94, 54, 2),
    ("card-back", 94, 54, 2),
]
DPI = 300


def logos():
    src = Image.open(REPO / "docs/play-store/feature-graphic-1024x500.png").convert("RGB")
    white, color = Image.new("RGBA", src.size), Image.new("RGBA", src.size)
    sp, wp, cp = src.load(), white.load(), color.load()
    for y in range(src.height):
        for x in range(src.width):
            r, g, b = sp[x, y]
            a = max(0.0, min(1.0, (246 - min(r, g, b)) / 246))
            if a <= 0.02:
                continue
            A = round(a * 255)
            wp[x, y] = (255, 255, 255, A)
            un = lambda v: max(0, min(255, round((v - (1 - a) * 255) / a)))
            cp[x, y] = (un(r), un(g), un(b), A)
    box = white.getbbox()
    pad = 6
    box = (box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad)
    white.crop(box).save(ROOT / "assets/logo-white.png")
    color.crop(box).save(ROOT / "assets/logo-color.png")


def chrome(profile):
    return [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
            f"--user-data-dir={profile}", "--virtual-time-budget=6000"]


def render(name, w_mm, h_mm, bleed_mm, profile):
    url = (ROOT / f"{name}.html").as_uri()
    px = lambda mm: math.ceil(mm * 96 / 25.4)
    png = ROOT / "out" / f"{name}.png"
    subprocess.run(chrome(profile) + [f"--force-device-scale-factor={DPI / 96}", f"--window-size={px(w_mm)},{px(h_mm)}",
                                      f"--screenshot={png}", url], check=True, capture_output=True)
    subprocess.run(chrome(profile) + ["--no-pdf-header-footer", f"--print-to-pdf={ROOT / 'out' / (name + '.pdf')}", url],
                   check=True, capture_output=True)
    # Trimmed copy (what the finished piece looks like, bleed cut off) for previews and phone sharing.
    im = Image.open(png)
    b = round(bleed_mm * DPI / 25.4)
    tw, th = round((w_mm - 2 * bleed_mm) * DPI / 25.4), round((h_mm - 2 * bleed_mm) * DPI / 25.4)
    im.crop((b, b, b + tw, b + th)).save(ROOT / "out" / f"{name}-trim.png")
    print("rendered", name)


def preview(profile):
    subprocess.run(chrome(profile) + ["--window-size=1600,1000", f"--screenshot={ROOT / 'out' / 'preview.png'}",
                                      (ROOT / "preview.html").as_uri()], check=True, capture_output=True)
    print("rendered preview")


if __name__ == "__main__":
    only = set(sys.argv[1:])
    if not only or "logos" in only:
        logos()
    (ROOT / "out").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as profile:
        for page in PAGES:
            if not only or page[0] in only:
                render(*page, profile)
        if not only or "preview" in only:
            preview(profile)
