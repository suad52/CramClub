# Contact sheet: python3 sheet.py OUT.png COLS TILE img1 img2 ...
import sys
from PIL import Image, ImageDraw
out, cols, tile = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
paths = sys.argv[4:]
rows = (len(paths) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tile, rows * (tile + 18)), (236, 228, 214))
d = ImageDraw.Draw(sheet)
for i, p in enumerate(paths):
    im = Image.open(p).convert("RGBA").resize((tile, tile))
    x, y = (i % cols) * tile, (i // cols) * (tile + 18)
    sheet.paste(im, (x, y + 18), im)
    d.text((x + 4, y + 3), p.rsplit("/", 1)[-1].replace(".png", ""), fill=(40, 30, 25))
sheet.save(out)
