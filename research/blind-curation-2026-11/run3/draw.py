"""Draw the genomes for the third blind curation.

Shuffles the pool with a fixed seed and prints the whole order. The run takes
the first three that pass the rules in PREREGISTRATION.md, in this order.

Usage: python3 draw.py
"""
import csv
import random
from pathlib import Path

SEED = "openpretext blind run 3, build 355be21"
MAX_MAP_BYTES = 1_000_000_000

rows = list(csv.DictReader(open(Path(__file__).parent / "pool.tsv"), delimiter="\t"))
rows.sort(key=lambda r: r["id"])
random.Random(SEED).shuffle(rows)
for n, r in enumerate(rows, 1):
    note = "  (over the size limit, skipped)" if int(r["map_bytes"]) > MAX_MAP_BYTES else ""
    print(f"{n:2d}  {r['id']:12s} {r['species']:32s} {int(r['map_bytes']) / 1e6:7.0f} MB{note}")
