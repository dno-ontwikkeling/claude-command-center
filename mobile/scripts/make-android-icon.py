# Generates the Android launcher icons from the desktop icon's design
# (build/make-icon.py): four terminal panes in the status colors.
# Legacy icons (ic_launcher / ic_launcher_round) for API < 26, and the
# adaptive foreground (ic_launcher_foreground) on a #161618 background.
# Run from the repo root: py mobile/scripts/make-android-icon.py
from pathlib import Path
from PIL import Image, ImageDraw

S = 1024
BG = '#161618'
BORDER = '#2c2c30'
PANE = '#0e0e10'
COLORS = ['#e0a458', '#5cc98c', '#e06a5e', '#5aa3e0']
PAD, GAP = 136, 48

RES = Path(__file__).resolve().parents[1] / 'android/app/src/main/res'
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}


def panes():
    """The 2x2 pane grid on transparent, cropped to its bounds."""
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    size = (S - 2 * PAD - GAP) // 2
    for i, color in enumerate(COLORS):
        x0 = PAD + (i % 2) * (size + GAP)
        y0 = PAD + (i // 2) * (size + GAP)
        d.rounded_rectangle((x0, y0, x0 + size, y0 + size), radius=56, fill=PANE, outline=color, width=20)
        cx, cy, u, w = x0 + size * 0.30, y0 + size * 0.50, size * 0.14, 30
        d.line([(cx - u * 0.6, cy - u), (cx + u * 0.6, cy), (cx - u * 0.6, cy + u)], fill=color, width=w, joint='curve')
        d.rounded_rectangle((cx + u * 1.1, cy + u - w / 2, cx + u * 2.9, cy + u + w / 2), radius=w // 2, fill=color)
    return img.crop((PAD, PAD, S - PAD, S - PAD))


def compose(shape, grid_frac):
    """Full icon at 1024: background shape plus the grid centred at grid_frac of the width."""
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if shape == 'square':
        d.rounded_rectangle((32, 32, S - 32, S - 32), radius=200, fill=BG, outline=BORDER, width=12)
    elif shape == 'circle':
        d.ellipse((16, 16, S - 16, S - 16), fill=BG, outline=BORDER, width=12)
    side = int(S * grid_frac)
    g = panes().resize((side, side), Image.LANCZOS)
    img.alpha_composite(g, ((S - side) // 2, (S - side) // 2))
    return img


legacy = compose('square', 752 / S)  # same proportions as the desktop icon
round_ = compose('circle', 0.62)  # fits inside the circle
# Adaptive: 108dp canvas, launchers mask to as small as a 72dp circle; the
# grid diagonal must fit inside it (side <= 72/sqrt(2) = 51dp = 0.47).
foreground = compose(None, 0.44)

for name, scale in DENSITIES.items():
    out = RES / f'mipmap-{name}'
    legacy.resize((round(48 * scale),) * 2, Image.LANCZOS).save(out / 'ic_launcher.png')
    round_.resize((round(48 * scale),) * 2, Image.LANCZOS).save(out / 'ic_launcher_round.png')
    foreground.resize((round(108 * scale),) * 2, Image.LANCZOS).save(out / 'ic_launcher_foreground.png')
print('icons written to', RES)
