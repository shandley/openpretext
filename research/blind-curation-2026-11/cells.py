# /// script
# dependencies = ["pillow", "numpy"]
# ///
"""Measure, on a screenshot of the whole map, how red each cell of the contig grid is,
and whether the red runs along the cell's diagonal or its anti-diagonal."""
import sys, numpy as np
from PIL import Image
img, tsv, x0, x1, y0, y1 = sys.argv[1], sys.argv[2], *map(float, sys.argv[3:7])
minw = int(sys.argv[7]) if len(sys.argv) > 7 else 100
a = np.asarray(Image.open(img).convert('RGB')).astype(int)
red = ((a[:, :, 0] > 150) & (a[:, :, 1] < 140) & (a[:, :, 2] < 140)).astype(float)
names, widths = [], []
for l in open(tsv):
    n, w = l.split('\t')[:2]; names.append(n); widths.append(int(w))
N = sum(widths); starts = np.cumsum([0] + widths)
big = [i for i, w in enumerate(widths) if w >= minw]
def px(t, lo, hi): return lo + t / N * (hi - lo)
for i in big:
    best = []
    for j in big:
        if i == j: continue
        r0, r1 = int(px(starts[i], y0, y1)) + 2, int(px(starts[i + 1], y0, y1)) - 2
        c0, c1 = int(px(starts[j], x0, x1)) + 2, int(px(starts[j + 1], x0, x1)) - 2
        cell = red[r0:r1, c0:c1]
        if cell.size == 0: continue
        h, w = cell.shape
        # sample along diagonal and anti-diagonal bands
        k = 60; d = ad = 0.0
        for q in range(k):
            f = (q + 0.5) / k
            yy = int(f * h); xa = int(f * w); xb = int((1 - f) * w) - 1
            d += cell[max(0, yy - 1):yy + 2, max(0, xa - 1):xa + 2].mean()
            ad += cell[max(0, yy - 1):yy + 2, max(0, xb - 1):xb + 2].mean()
        best.append((cell.mean(), d / k, ad / k, j))
    best.sort(reverse=True)
    out = [f"{names[j]}({m:.2f} d{d:.2f} a{ad:.2f})" for m, d, ad, j in best[:3]]
    print(f"{i:2d} {names[i]:22s} w={widths[i]:5d} | " + ' ; '.join(out))
