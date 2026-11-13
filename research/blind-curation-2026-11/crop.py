# /// script
# dependencies = ["pillow"]
# ///
import sys
from PIL import Image
src, dst, x, y, w, h = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:7])
scale = float(sys.argv[7]) if len(sys.argv) > 7 else 1
im = Image.open(src).crop((x, y, x + w, y + h))
if scale != 1: im = im.resize((int(w * scale), int(h * scale)), Image.NEAREST if scale > 1 else Image.LANCZOS)
im.save(dst)
