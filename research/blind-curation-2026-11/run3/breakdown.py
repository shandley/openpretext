"""Break the curator's breaks and joins down by kind, and say which were found.

Uses score_agp.py's definitions and matching. A curator's break is
- "inside a chromosome" when the two sides stay in one of the curator's
  chromosomes, both placed (an inversion or reorder), and
- "between chromosomes" otherwise (a misjoin, or a piece taken out).
A curator's join is sized by the smaller of the two pieces it joins.

Usage: python3 breakdown.py curator.agp blind.agp
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from score_agp import TOLERANCE_TEXELS, continuous, left_end, load, near, right_end  # noqa: E402

BIG = 5_000_000


def placed_rows(objs):
    for name, rows in objs.items():
        painted = any(r['painted'] for r in rows)
        yield name, painted, [r for r in rows if not r['unloc']] if painted else rows


def joins_of(objs):
    out = []
    for _, _, rows in placed_rows(objs):
        for x, y in zip(rows, rows[1:]):
            if not continuous(x, y):
                size = min(x['end'] - x['beg'] + 1, y['end'] - y['beg'] + 1)
                out.append(((right_end(x), left_end(y)), size, x['seq'] == y['seq']))
    return out


def breaks_of(objs):
    kept, where = set(), {}
    for name, painted, rows in placed_rows(objs):
        for x, y in zip(rows, rows[1:]):
            if continuous(x, y):
                kept.add((x['seq'], max(x['beg'], y['beg'])))
        for r in rows:
            where[(r['seq'], r['beg'])] = where[(r['seq'], r['end'] + 1)] = name if painted else None
    # Unlocalised rows are not placed anywhere.
    for name, rows in objs.items():
        for r in rows:
            where.setdefault((r['seq'], r['beg']), None)
            where.setdefault((r['seq'], r['end'] + 1), None)
    pieces = {}
    for rows in objs.values():
        for r in rows:
            pieces.setdefault(r['seq'], []).append(r)
    out = []
    for seq, rows in pieces.items():
        rows.sort(key=lambda r: r['beg'])
        for a, b in zip(rows, rows[1:]):
            if (seq, b['beg']) in kept:
                continue
            ca = next((n for n, p, rs in placed_rows(objs) if p and a in rs), None)
            cb = next((n for n, p, rs in placed_rows(objs) if p and b in rs), None)
            out.append(((seq, b['beg']), ca is not None and ca == cb))
    return out


def main():
    res, ref = load(sys.argv[1])
    _, test = load(sys.argv[2])
    tol = TOLERANCE_TEXELS * res
    tb = [b for b, _ in breaks_of(test)]
    tj = [j for j, _, _ in joins_of(test)]

    def take(pool, same):
        for t in pool:
            if same(t):
                pool.remove(t)
                return True
        return False

    rows = {}
    for b, inside in breaks_of(ref):
        key = 'breaks inside a chromosome' if inside else 'breaks between chromosomes'
        hit = take(tb, lambda t: near(b, t, tol))
        n, h = rows.get(key, (0, 0))
        rows[key] = (n + 1, h + hit)
    for (p, q), size, same_seq in joins_of(ref):
        key = f"joins, smaller piece {'5 Mb or more' if size >= BIG else 'under 5 Mb'}"
        hit = take(tj, lambda t: (near(p, t[0], tol) and near(q, t[1], tol)) or (near(p, t[1], tol) and near(q, t[0], tol)))
        n, h = rows.get(key, (0, 0))
        rows[key] = (n + 1, h + hit)
        if same_seq:
            n, h = rows.get('  of which both pieces from one sequence', (0, 0))
            rows['  of which both pieces from one sequence'] = (n + 1, h + hit)
    for key in sorted(rows):
        n, h = rows[key]
        print(f'  {key}: curator {n}, found {h}')
    print(f'  breaks made that the curator did not make: {len(tb)}')
    print(f'  joins made that the curator did not make: {len(tj)}')


main()
