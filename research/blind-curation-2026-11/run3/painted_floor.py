"""Make the floor the earlier runs used: the curation's own painting with no edits.

Takes the no-edit AGP and the blind AGP of one map. Every original sequence of
which the blind curation painted any part is marked Painted in the no-edit
file, as a chromosome of its own. Nothing is cut, moved, joined or turned.
This is the "every chromosome-scale scaffold painted as loaded" floor of the
second run, with "chromosome-scale" defined by what the blind curation painted.

Usage: python3 painted_floor.py baseline.agp blind.agp > floor.agp
"""
import sys

painted = set()
for line in open(sys.argv[2]):
    f = line.rstrip('\n').split('\t')
    if not line.startswith('#') and len(f) > 9 and f[4] == 'W' and 'Painted' in f[9:]:
        painted.add(f[5])
for line in open(sys.argv[1]):
    f = line.rstrip('\n').split('\t')
    if not line.startswith('#') and len(f) > 5 and f[4] == 'W' and f[5] in painted and 'Painted' not in f[9:]:
        f = f[:9] + ['Painted'] + f[9:]
    sys.stdout.write('\t'.join(f) + '\n')
