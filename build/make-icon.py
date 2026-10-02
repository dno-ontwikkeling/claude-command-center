# Generates build/icon.png (512) and build/icon.ico (16-256) for electron-builder.
# Four terminal panes in the app's status colors: busy, ok, needs-input, unseen.
# Run: py build/make-icon.py
from pathlib import Path
from PIL import Image, ImageDraw

S = 1024
BG = '#161618'
BORDER = '#2c2c30'
PANE = '#0e0e10'
COLORS = ['#e0a458', '#5cc98c', '#e06a5e', '#5aa3e0']

img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle((32, 32, S - 32, S - 32), radius=200, fill=BG, outline=BORDER, width=12)

pad, gap = 136, 48
size = (S - 2 * pad - gap) // 2
for i, color in enumerate(COLORS):
    x0 = pad + (i % 2) * (size + gap)
    y0 = pad + (i // 2) * (size + gap)
    d.rounded_rectangle((x0, y0, x0 + size, y0 + size), radius=56, fill=PANE, outline=color, width=20)
    # "›_" prompt glyph
    cx, cy, u, w = x0 + size * 0.30, y0 + size * 0.50, size * 0.14, 30
    d.line([(cx - u * 0.6, cy - u), (cx + u * 0.6, cy), (cx - u * 0.6, cy + u)], fill=color, width=w, joint='curve')
    d.rounded_rectangle((cx + u * 1.1, cy + u - w / 2, cx + u * 2.9, cy + u + w / 2), radius=w // 2, fill=color)

out = Path(__file__).parent
img.resize((512, 512), Image.LANCZOS).save(out / 'icon.png')
img.save(out / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
