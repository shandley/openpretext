"""Score a curation AGP against a reference curation AGP of the same map.

Both files are in PretextView's layout (what OpenPretext's pipeline export
writes). The score has three parts, each also worth computing for a no-edit
export, which is the floor any curation has to beat.

1. Misassigned bases. Every base of the input assembly is in a painted
   chromosome or in none. Chromosomes of the two files are paired one to one
   by shared bases (largest overlap first). A base is misassigned if the two
   files put it in chromosomes that are not a pair, or one paints it and the
   other does not. Unlocalised pieces count as in their chromosome.
2. Breaks. A break is a point inside an input sequence where the curation
   separates the two sides (they are no longer neighbours in the original
   orientation). A break matches one in the other file if it is in the same
   sequence within TOLERANCE_TEXELS.
3. Joins. A join is two piece ends from different places made neighbours
   inside a chromosome, not counting unlocalised pieces, whose position in
   the chromosome carries no meaning. Joins match if both ends match within
   the tolerance. Turning a whole chromosome round does not change its joins.

Usage: python3 score_agp.py reference.agp test.agp [label]
"""
import sys
from collections import defaultdict

TOLERANCE_TEXELS = 3


def load(path):
    res, objs = None, {}
    for line in open(path):
        if 'HiC MAP RESOLUTION' in line:
            res = float(line.split(':')[1].split()[0])
        if line.startswith('#') or not line.strip():
            continue
        f = line.rstrip('\n').split('\t')
        if f[4] != 'W':
            continue
        extra = [x for x in f[9:] if x.strip()]
        objs.setdefault(f[0], []).append(dict(
            seq=f[5], beg=int(f[6]), end=int(f[7]), minus=f[8] == '-',
            painted='Painted' in extra, unloc='Unloc' in extra))
    return res, objs


def assignment(objs):
    """seq -> sorted [(beg, end, chromosome or None)]"""
    out = defaultdict(list)
    for name, rows in objs.items():
        for r in rows:
            out[r['seq']].append((r['beg'], r['end'], name if r['painted'] else None))
    for v in out.values():
        v.sort()
    return out


def misassigned(ref, test):
    a, b = assignment(ref), assignment(test)
    table, total = defaultdict(int), 0
    for seq in set(a) | set(b):
        cuts = sorted({p for lst in (a.get(seq, []), b.get(seq, [])) for (s, e, _) in lst for p in (s, e + 1)})

        def at(lst, pos):
            for s, e, c in lst:
                if s <= pos <= e:
                    return c
            return None
        for lo, hi in zip(cuts, cuts[1:]):
            table[(at(a.get(seq, []), lo), at(b.get(seq, []), lo))] += hi - lo
            total += hi - lo
    pairs, used_a, used_b = {}, set(), set()
    for (ca, cb), n in sorted(table.items(), key=lambda kv: -kv[1]):
        if ca is None or cb is None or ca in used_a or cb in used_b:
            continue
        pairs[ca] = cb
        used_a.add(ca)
        used_b.add(cb)
    right = sum(n for (ca, cb), n in table.items() if (ca is None and cb is None) or (ca is not None and pairs.get(ca) == cb))
    return total - right, total


def left_end(r):
    return (r['seq'], r['end'] + 1) if r['minus'] else (r['seq'], r['beg'])


def right_end(r):
    return (r['seq'], r['beg']) if r['minus'] else (r['seq'], r['end'] + 1)


def continuous(x, y):
    """y follows x exactly as in the input sequence (either strand)."""
    if x['seq'] != y['seq'] or x['minus'] != y['minus']:
        return False
    return (y['beg'] == x['end'] + 1) if not x['minus'] else (x['beg'] == y['end'] + 1)


def breaks_and_joins(objs):
    kept, joins = set(), []
    for rows in objs.values():
        placed = [r for r in rows if not r['unloc']] if any(r['painted'] for r in rows) else rows
        for x, y in zip(placed, placed[1:]):
            if continuous(x, y):
                kept.add((x['seq'], max(x['beg'], y['beg'])))
            else:
                joins.append((right_end(x), left_end(y)))
    pieces = defaultdict(list)
    for rows in objs.values():
        for r in rows:
            pieces[r['seq']].append(r['beg'])
    breaks = [(seq, b) for seq, begs in pieces.items() for b in sorted(begs)[1:] if (seq, b) not in kept]
    return breaks, joins


def near(p, q, tol):
    return p[0] == q[0] and abs(p[1] - q[1]) <= tol


def matched(ref_items, test_items, same):
    left = list(test_items)
    hits = 0
    for r in ref_items:
        for t in left:
            if same(r, t):
                left.remove(t)
                hits += 1
                break
    return hits


def main():
    res, ref = load(sys.argv[1])
    _, test = load(sys.argv[2])
    label = sys.argv[3] if len(sys.argv) > 3 else sys.argv[2]
    tol = TOLERANCE_TEXELS * res
    wrong, total = misassigned(ref, test)
    rb, rj = breaks_and_joins(ref)
    tb, tj = breaks_and_joins(test)
    hb = matched(rb, tb, lambda r, t: near(r, t, tol))
    hj = matched(rj, tj, lambda r, t: (near(r[0], t[0], tol) and near(r[1], t[1], tol)) or (near(r[0], t[1], tol) and near(r[1], t[0], tol)))
    print(f'{label}')
    print(f'  misassigned bases: {wrong:,} of {total:,} ({100 * wrong / total:.3f}%)')
    print(f'  breaks: reference {len(rb)}, test {len(tb)}, matched {hb}')
    print(f'  joins:  reference {len(rj)}, test {len(tj)}, matched {hj}')


main()
