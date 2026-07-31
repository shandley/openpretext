"""Blind re-validation of cross-species P(s) decay fits from Hi-C overview maps.

Reads only raw decay-curve.tsv files. Recomputes OLS slope (decay exponent) and
R-squared, runs robustness variants, and quantifies the relationship between fit
quality and methodological factors (point count, fit range, binning). No prior
conclusions are read; all 18 species are treated symmetrically.
"""

from __future__ import annotations
import pathlib
import numpy as np
from scipy import stats

BASE = pathlib.Path("/Users/shandley/Code/software/openpretext/manuscript/analysis")
OUT = pathlib.Path(
    "/Users/shandley/Code/software/openpretext/manuscript/reeval-2026-07-13/revalidation"
)

SPECIES = [
    "armadillo", "bat", "coelacanth", "crocodile", "finch", "frog", "gharial",
    "koala", "lancelet", "quail", "shark", "stubfoot", "toad", "tortoise",
    "turtle", "whiptail", "wrasse", "wrasse", "xenopus",
]
# de-dup guard (typo safety)
SPECIES = list(dict.fromkeys(SPECIES))


def load(sp: str):
    """Return (header_exp, header_r2, dist, logd, logc) for a species."""
    p = BASE / sp / "decay-curve.tsv"
    header_exp = header_r2 = None
    rows = []
    for line in p.read_text().splitlines():
        if line.startswith("#"):
            if "Decay exponent" in line:
                header_exp = float(line.split(":")[1])
            elif "R-squared" in line:
                header_r2 = float(line.split(":")[1])
            continue
        if line.startswith("distance"):
            continue
        parts = line.split("\t")
        if len(parts) < 4:
            continue
        rows.append([float(x) for x in parts[:4]])
    a = np.array(rows)
    dist, mean_c, logd, logc = a[:, 0], a[:, 1], a[:, 2], a[:, 3]
    return header_exp, header_r2, dist, mean_c, logd, logc


def ols(x, y):
    """Return (slope, r2, n). r2 is squared Pearson r of the linear fit."""
    if len(x) < 3:
        return np.nan, np.nan, len(x)
    res = stats.linregress(x, y)
    return res.slope, res.rvalue ** 2, len(x)


def logbin(dist, mean_c, n_bins=15):
    """Log-spaced binning over distance, averaging mean_contacts within bins,
    then fit log10(dist_center) vs log10(mean_contacts)."""
    mask = (dist > 0) & (mean_c > 0)
    d, c = dist[mask], mean_c[mask]
    edges = np.logspace(np.log10(d.min()), np.log10(d.max()), n_bins + 1)
    xs, ys = [], []
    for i in range(n_bins):
        lo, hi = edges[i], edges[i + 1]
        sel = (d >= lo) & (d <= hi) if i == n_bins - 1 else (d >= lo) & (d < hi)
        if sel.sum() == 0:
            continue
        xs.append(np.log10(d[sel].mean()))
        ys.append(np.log10(c[sel].mean()))
    return ols(np.array(xs), np.array(ys))


def main():
    print(f"{'species':<12} {'n':>4} {'exp_full':>9} {'r2_full':>8} "
          f"{'hExp':>8} {'hR2':>7} {'d_exp':>7} {'d_r2':>7}")
    print("-" * 74)

    table = []  # dict per species
    common_max = None

    # first pass to find common window (min n across species)
    ns = {}
    data = {}
    for sp in SPECIES:
        he, hr, dist, mean_c, logd, logc = load(sp)
        data[sp] = (he, hr, dist, mean_c, logd, logc)
        ns[sp] = len(dist)
    common_max = min(ns.values())  # smallest curve caps the common window

    for sp in SPECIES:
        he, hr, dist, mean_c, logd, logc = data[sp]
        n = len(dist)

        # 1. REPRODUCE: OLS over all points
        exp_full, r2_full, _ = ols(logd, logc)

        # 2a. drop first 3 bins (within-bin / very-short-range noise)
        m3 = dist >= 4
        exp_d3, r2_d3, n_d3 = ols(logd[m3], logc[m3])

        # 2a'. drop first 5 bins
        m5 = dist >= 6
        exp_d5, r2_d5, n_d5 = ols(logd[m5], logc[m5])

        # 2b. common window across all species: distance 1..common_max
        mc = dist <= common_max
        exp_cw, r2_cw, n_cw = ols(logd[mc], logc[mc])

        # 2b'. wider common window over subset with n>=50: dist 1..50
        exp_w50 = r2_w50 = np.nan
        if n >= 50:
            m50 = dist <= 50
            exp_w50, r2_w50, _ = ols(logd[m50], logc[m50])

        # 2c. log-spaced binning (rebalances long-range flat noise)
        exp_lb, r2_lb, n_lb = logbin(dist, mean_c, n_bins=15)

        d_exp = exp_full - (he if he is not None else np.nan)
        d_r2 = r2_full - (hr if hr is not None else np.nan)

        print(f"{sp:<12} {n:>4} {exp_full:>9.4f} {r2_full:>8.4f} "
              f"{he:>8.4f} {hr:>7.4f} {d_exp:>7.4f} {d_r2:>7.4f}")

        table.append(dict(
            species=sp, n_points=n,
            header_exp=he, header_r2=hr,
            exp_full=exp_full, r2_full=r2_full,
            d_exp_vs_header=d_exp, d_r2_vs_header=d_r2,
            exp_drop3=exp_d3, r2_drop3=r2_d3,
            exp_drop5=exp_d5, r2_drop5=r2_d5,
            exp_common=exp_cw, r2_common=r2_cw, common_max=common_max,
            exp_w50=exp_w50, r2_w50=r2_w50,
            exp_logbin=exp_lb, r2_logbin=r2_lb,
        ))

    # ---- write CSV ----
    import csv
    keys = list(table[0].keys())
    with open(OUT / "revalidation-table.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        for row in table:
            w.writerow({k: (f"{v:.6f}" if isinstance(v, float) and not np.isnan(v)
                            else ("" if isinstance(v, float) and np.isnan(v) else v))
                        for k, v in row.items()})

    # ---- summary statistics ----
    n_arr = np.array([t["n_points"] for t in table], float)
    r2_full = np.array([t["r2_full"] for t in table], float)
    exp_full = np.array([t["exp_full"] for t in table], float)
    r2_head = np.array([t["header_r2"] for t in table], float)
    exp_head = np.array([t["header_exp"] for t in table], float)
    r2_cw = np.array([t["r2_common"] for t in table], float)
    exp_cw = np.array([t["exp_common"] for t in table], float)
    r2_lb = np.array([t["r2_logbin"] for t in table], float)

    print("\n=== REPRODUCTION vs HEADER ===")
    print(f"max |exp diff|: {np.nanmax(np.abs(exp_full - exp_head)):.5f}")
    print(f"max |r2  diff|: {np.nanmax(np.abs(r2_full - r2_head)):.5f}")

    def corr(a, b, label):
        m = ~np.isnan(a) & ~np.isnan(b)
        pr = stats.pearsonr(a[m], b[m])
        sr = stats.spearmanr(a[m], b[m])
        print(f"{label:<40} Pearson r={pr.statistic:+.3f} (p={pr.pvalue:.3g})"
              f"  Spearman rho={sr.statistic:+.3f} (p={sr.pvalue:.3g})  n={m.sum()}")
        return pr, sr

    print("\n=== CONFOUND: fit quality vs point count ===")
    corr(n_arr, r2_full, "R2(full) vs n_points")
    corr(n_arr, np.abs(exp_full), "|exponent(full)| vs n_points")
    corr(n_arr, exp_full, "exponent(full, signed) vs n_points")

    # regress R2 on n_points, inspect residuals symmetrically
    m = ~np.isnan(r2_full)
    reg = stats.linregress(n_arr[m], r2_full[m])
    resid = r2_full - (reg.slope * n_arr + reg.intercept)
    print(f"\nR2 = {reg.slope:.5f}*n + {reg.intercept:.4f}  (R2 of this reg = {reg.rvalue**2:.3f})")
    order = np.argsort(resid)
    print("Residuals of R2-on-n regression (most negative -> most positive):")
    for i in order:
        print(f"  {table[i]['species']:<12} n={int(n_arr[i]):>4} "
              f"r2={r2_full[i]:.3f} resid={resid[i]:+.3f}")

    print("\n=== SPREAD across fit variants (per-species std of R2) ===")
    variants = ["r2_full", "r2_drop3", "r2_drop5", "r2_common", "r2_logbin"]
    for t in table:
        vals = np.array([t[v] for v in variants], float)
        vals = vals[~np.isnan(vals)]
        print(f"  {t['species']:<12} R2 range [{vals.min():.3f}, {vals.max():.3f}] "
              f"spread={vals.max()-vals.min():.3f}")

    print("\n=== SPREAD COLLAPSE under common window (1..%d px) ===" % table[0]["common_max"])
    print(f"R2 full   : std={np.nanstd(r2_full):.3f} range=[{np.nanmin(r2_full):.3f},{np.nanmax(r2_full):.3f}]")
    print(f"R2 common : std={np.nanstd(r2_cw):.3f} range=[{np.nanmin(r2_cw):.3f},{np.nanmax(r2_cw):.3f}]")
    print(f"exp full  : std={np.nanstd(exp_full):.3f} range=[{np.nanmin(exp_full):.3f},{np.nanmax(exp_full):.3f}]")
    print(f"exp common: std={np.nanstd(exp_cw):.3f} range=[{np.nanmin(exp_cw):.3f},{np.nanmax(exp_cw):.3f}]")
    print(f"R2 logbin : std={np.nanstd(r2_lb):.3f} range=[{np.nanmin(r2_lb):.3f},{np.nanmax(r2_lb):.3f}]")

    # correlation of common-window R2 with n (should weaken if artifact)
    print("\n=== Does R2-vs-n survive the common window? ===")
    corr(n_arr, r2_cw, "R2(common window) vs n_points")

    # per-species rank persistence full-range vs common-window
    print("\n=== Rank persistence: full-range R2 vs common-window R2 ===")
    sr = stats.spearmanr(r2_full, r2_cw)
    print(f"Spearman rank corr = {sr.statistic:+.3f} (p={sr.pvalue:.3g})")
    worst = table[int(np.argmin(r2_full))]
    print(f"worst full-range fit: {worst['species']} "
          f"(r2_full={worst['r2_full']:.3f} -> r2_common={worst['r2_common']:.3f})")

    # wider common window over n>=50 subset (1..50 px)
    print("\n=== Wider common window (1..50 px) over n>=50 subset ===")
    r2_w50 = np.array([t["r2_w50"] for t in table], float)
    sub = ~np.isnan(r2_w50)
    print(f"subset size: {sub.sum()}")
    print(f"R2 full  (subset): std={np.std(r2_full[sub]):.3f} "
          f"range=[{r2_full[sub].min():.3f},{r2_full[sub].max():.3f}]")
    print(f"R2 w50   (subset): std={np.std(r2_w50[sub]):.3f} "
          f"range=[{r2_w50[sub].min():.3f},{r2_w50[sub].max():.3f}]")


if __name__ == "__main__":
    main()
