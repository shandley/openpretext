# /// script
# dependencies = ["pillow"]
# ///
import sys
from PIL import Image, ImageDraw
out, cols, *files = sys.argv[1], int(sys.argv[2]), *sys.argv[3:]
ims = [Image.open(f) for f in files]
w, h = ims[0].size
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (w * cols, h * rows), 'white')
for i, (im, f) in enumerate(zip(ims, files)):
    sheet.paste(im, ((i % cols) * w, (i // cols) * h))
    ImageDraw.Draw(sheet).text(((i % cols) * w + 150, (i // cols) * h + 140), f.split('/')[-1][:-4], fill='blue')
sheet.save(out)
