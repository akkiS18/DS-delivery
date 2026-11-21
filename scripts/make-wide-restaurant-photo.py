"""Makes a wide (2:1) restaurant picture from a square logo (owner request 2026-11-22, Asl Market / Tengsiz food).

The app has ONE restaurant picture and shows it with object-fit: cover, centred, in every frame: wide frames (home card ~2.1:1,
menu header ~1.6:1) and small squares (search / closed rows 56 px, order logo 44 px). So the picture is a banner whose centre square
is the whole logo: square frames show just the logo, wide frames show the logo plus sides that continue the logo's own background
with a soft glow in the brand colour (no blurred copy of the logo: the owner turned that look down on 2026-11-11).

  python scripts/make-wide-restaurant-photo.py logo.jpg out.webp [--bg auto|#rrggbb] [--glow auto|none|#rrggbb] [--preview dir]

--bg auto = the average colour of the logo's outer border; --glow auto = the average of its strongly coloured pixels.
--preview writes the crops the app will show (card, menu header, square) for checking by eye.
"""
import argparse
import colorsys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

H = 800
W = 2 * H


def hex_rgb(s: str) -> tuple[int, int, int]:
    s = s.lstrip('#')
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def border_colour(img: Image.Image) -> tuple[int, int, int]:
    """Median colour of the logo's left and right edge columns (the parts that meet the banner sides)."""
    w, h = img.size
    px = img.load()
    band = max(2, w // 100)
    pts = [px[x, y] for y in range(h) for x in list(range(band)) + list(range(w - band, w))]
    return tuple(sorted(p[i] for p in pts)[len(pts) // 2] for i in range(3))  # type: ignore[return-value]


def brand_colour(img: Image.Image) -> tuple[int, int, int] | None:
    small = img.resize((120, 120))
    picked = []
    for r, g, b in small.get_flattened_data():
        hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        if s > 0.55 and v > 0.45:
            picked.append((r, g, b))
    if len(picked) < 50:
        return None
    n = len(picked)
    return tuple(sum(p[i] for p in picked) // n for i in range(3))  # type: ignore[return-value]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('out')
    ap.add_argument('--bg', default='auto')
    ap.add_argument('--glow', default='auto')
    ap.add_argument('--preview')
    a = ap.parse_args()

    logo = Image.open(a.src).convert('RGB')
    bg = border_colour(logo) if a.bg == 'auto' else hex_rgb(a.bg)
    glow = None if a.glow == 'none' else (brand_colour(logo) if a.glow == 'auto' else hex_rgb(a.glow))

    lw = round(logo.width * H / logo.height)
    logo = logo.resize((lw, H), Image.LANCZOS)
    if lw > H:  # wider than the centre square: keep the middle square
        logo = logo.crop(((lw - H) // 2, 0, (lw - H) // 2 + H, H))
        lw = H

    canvas = Image.new('RGB', (W, H), bg)
    if glow:
        layer = Image.new('RGB', (W, H), glow)
        mask = Image.new('L', (W, H), 0)
        d = ImageDraw.Draw(mask)
        d.ellipse((W // 2 - H * 0.95, H * 0.10, W // 2 + H * 0.95, H * 0.90), fill=120)
        d.ellipse((W // 2 - H * 0.40, H * 0.10, W // 2 + H * 0.40, H * 0.90), fill=0)  # keep the glow off the logo's middle
        mask = mask.filter(ImageFilter.GaussianBlur(H // 7))
        canvas = Image.composite(layer, canvas, mask)

    # The logo's left/right edges fade into the banner so no seam shows.
    fade = max(8, lw // 14)
    m = Image.new('L', (lw, H), 255)
    md = ImageDraw.Draw(m)
    for i in range(fade):
        v = round(255 * i / fade)
        md.line([(i, 0), (i, H)], fill=v)
        md.line([(lw - 1 - i, 0), (lw - 1 - i, H)], fill=v)
    x0 = (W - lw) // 2
    # "lighter" blend: the logo's own dark background takes the glow behind it, its bright parts stay as they are -> no seam.
    logo = ImageChops.lighter(logo, canvas.crop((x0, 0, x0 + lw, H)))
    canvas.paste(logo, (x0, 0), m)
    canvas.save(a.out, 'WEBP', quality=82, method=6)
    print(f'{a.out}: {W}x{H}, bg {bg}, glow {glow}, {Path(a.out).stat().st_size // 1024} KB')

    if a.preview:
        p = Path(a.preview)
        p.mkdir(parents=True, exist_ok=True)

        def crop(ratio: float) -> Image.Image:
            w = min(W, round(H * ratio))
            h = min(H, round(w / ratio))
            return canvas.crop(((W - w) // 2, (H - h) // 2, (W + w) // 2, (H + h) // 2))
        crop(360 / 170).resize((720, 340)).save(p / 'card.png')
        head = crop(390 / 250).resize((780, 500))
        head = Image.blend(head, Image.new('RGB', head.size, (27, 48, 49)), 0.66)
        head.save(p / 'menu-header.png')
        crop(1).resize((112, 112)).save(p / 'square.png')


if __name__ == '__main__':
    main()
