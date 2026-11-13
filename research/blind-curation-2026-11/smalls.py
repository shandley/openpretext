# /// script
# dependencies = ["pillow", "numpy"]
# ///
"""For each small scaffold, which large scaffolds its row on the whole-map screenshot is reddest against,
and in which fifth of that scaffold."""
import sys, numpy as np
from PIL import Image
img, tsv, x0, x1, y0, y1 = sys.argv[1], sys.argv[2], *map(float, sys.argv[3:7])
a = np.asarray(Image.open(img).convert('RGB')).astype(int)
red = ((a[:, :, 0] > 150) & (a[:, :, 1] < 140) & (a[:, :, 2] < 140)).astype(float)
names, widths = zip(*[(l.split('\t')[0], int(l.split('\t')[1])) for l in open(tsv)])
N = sum(widths); starts = np.cumsum((0,) + widths)
px = lambda t, lo, hi: lo + t / N * (hi - lo)
big = [i for i, w in enumerate(widths) if w >= 400]
for i, w in enumerate(widths):
    if not (8 <= w < 400): continue
    r0, r1 = int(round(px(starts[i], y0, y1))), max(int(round(px(starts[i + 1], y0, y1))), int(round(px(starts[i], y0, y1))) + 1)
    res = []
    for j in big:
        c0, c1 = int(px(starts[j], x0, x1)) + 2, int(px(starts[j + 1], x0, x1)) - 2
        cell = red[r0:r1, c0:c1]
        fifths = [cell[:, int(k * cell.shape[1] / 5):int((k + 1) * cell.shape[1] / 5)].mean() for k in range(5)]
        res.append((cell.mean(), names[j], fifths))
    res.sort(reverse=True)
    print(f"{names[i]:24s} w={w:4d} rows {r0}-{r1} | " + ' ; '.join(f"{n} {m:.2f} [{' '.join(f'{f:.1f}' for f in fi)}]" for m, n, fi in res[:3]))
