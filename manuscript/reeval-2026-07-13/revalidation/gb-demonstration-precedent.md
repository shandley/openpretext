# What Genome Biology acceptance actually requires for a browser-based genome tool: precedent from HiGlass and JBrowse 2

Date: 2026-07-13
Question: Must a new browser-based genome tool include a formal quantitative concordance/equivalence
study against an incumbent desktop tool to be accepted at Genome Biology, or is a demonstration of
utility through worked examples and capability sufficient?

Framing note (verified): I could NOT confirm from any primary source I can reach which article TYPE
HiGlass and JBrowse 2 were published under. The BMC/Springer article pages that carry the section
label ("Software", "Method", etc.) now redirect to an authentication wall; PMC full text and the
CrossRef metadata (type = "journal-article" only, no subtype/group-title/category) do not carry the
section label. So this analysis is deliberately framed as "acceptance of a browser-based genome tool,"
not "the Software section" specifically. This does not weaken the verdict: whichever type these two
were filed under, including the stricter Method type, neither contained an output-equivalence study.

Method: read the actual accepted articles (full text via PMC) and the journal's own article-type
criteria. Every claim below is tied to a fetched source URL. Items I could not verify from a primary
fetch are flagged explicitly.

---

## 1. HiGlass (Kerpedjiev et al., Genome Biology 2018)

Source: full text retrieved from PubMed Central PMC6109259.
DOI: https://doi.org/10.1186/s13059-018-1486-1
PMC: https://pmc.ncbi.nlm.nih.gov/articles/PMC6109259/
(According to PubMed / PMC full text.)

What the Results actually contain. The Results section has four headings, all of which are use-case
or capability driven, not equivalence tests:

- "Exploring and comparing different experimental conditions" - a worked case study that
  re-visualizes the Schwarzer et al. Nipbl-deletion Hi-C data (wild-type vs delta-Nipbl mouse
  hepatocytes), navigating linked views to show loss of TAD-scale features and strengthening of A/B
  compartmentalization, and noticing a new "blotches" feature.
- "Comparing the results of feature callers" - a second worked case study that overlays the calls of
  seven TAD callers (data from Forcato et al.) on the same Hi-C map in eight synchronized views to
  show the lack of consensus between callers.
- "Creating interactive snapshots of genome-wide data" - a capability narrative about shareable,
  linkable interactive figures.
- "Feature overview and comparison with other viewers" - a qualitative capability comparison against
  Juicebox, Juicebox.js, Genome Contact Map Explorer, the Washington University Epigenome Browser,
  and the 3D Genome Browser. It compares which tools support continuous pan/zoom, side-by-side maps,
  view linking, track types, and deployment. This is a feature/capability comparison, not a numeric
  concordance or accuracy comparison.

Formal quantitative concordance/equivalence benchmark against an incumbent tool: NONE. The paper does
not show numeric agreement, correlation, or accuracy of HiGlass output versus any other tool.

Performance numbers: one usage statistic only. Of 2,770,448 tile requests to the public server
between Feb 2017 and Jul 2018, more than 96.7 percent were served with latency under 0.5 s. This is
a server-latency usage stat, not a head-to-head speed benchmark against another tool.

Verdict for HiGlass: advance demonstrated through two worked biological case studies plus a
qualitative capability comparison and a reproducibility/sharing story. No equivalence study.

---

## 2. JBrowse 2 (Diesh et al., Genome Biology 2023)

Source: full text retrieved from PubMed Central PMC10108523.
DOI: https://doi.org/10.1186/s13059-023-02914-z
PMC: https://pmc.ncbi.nlm.nih.gov/articles/PMC10108523/
(According to PubMed / PMC full text.)

What the Results/main body actually contain. The abstract states plainly: "We describe application
functionality, use cases, performance benchmarks, and implementation notes." The body sections are:
"Advances in JBrowse 2", "The JBrowse 2 product range", "Sessions, assemblies, views, and tracks",
"The Linear Genome View", "Beyond the linear genome view", "Displaying and comparing multiple
assemblies", "Displaying structural variation", "Visualizing long reads", "Ways to access data",
"Performance and scalability", "Administration and configuration", plus Discussion, Conclusions,
Methods.

The advance is demonstrated through capability breadth and worked examples: new view types (Circular,
Dotplot, Tabular, Linear Synteny, Breakpoint Split), an SV Inspector workflow motivated by a cancer
structural-variant use case, synteny/dotplot views across multiple assemblies, long-read and
methylation (MM-tag) rendering. These are illustrated with figures, not scored against another tool's
output.

Formal quantitative concordance/equivalence benchmark against an incumbent tool: NONE. The paper does
not test whether JBrowse 2 reproduces another browser's output to some numeric tolerance.

Performance/scalability: YES, but it is a speed benchmark, not an equivalence benchmark. Using
Puppeteer, they profiled end-to-end load-and-render time and frame rate for JBrowse 2 (parallel and
serial), JBrowse 1, and igv.js, rendering BAM/CRAM at varying coverage (reads simulated with pbsim2
and wgsim, aligned with minimap2, N = 10 runs, standard error bars). Finding: JBrowse 2 has
"comparable performance to igv.js" for a single track and gains from parallel rendering across
multiple tracks. This compares rendering speed and responsiveness, not correctness/agreement of
displayed data.

There is also a capability comparison in prose against other synteny/SV tools (GBrowse-Syn, ACT,
Ribbon, Circos, IGV, CNSpector), similar in spirit to HiGlass's feature comparison.

Verdict for JBrowse 2: advance demonstrated through capability breadth, worked SV/synteny/long-read
use cases, and a quantitative speed benchmark. No output-equivalence study against an incumbent.

---

## 3. Genome Biology article-type criteria

Live status: the current guideline pages on genomebiology.biomedcentral.com now 301-redirect to
link.springer.com, which is behind an authentication cookie wall (idp.springer.com). I could not
fetch the Software or Brief-report criteria verbatim from a primary source in this environment. FLAG:
the Software-article-type wording below is therefore NOT verbatim-verified.

What I did verify (Methodology article type), quoted from the journal's own guideline text as surfaced
in search of link.springer.com/journal/13059/submission-guidelines/methodology:

"Methodology articles in Genome Biology should describe novel methods that are shown to be a clear
advance over existing state-of-the-art methods in a side-by-side demonstration, where possible. Where
possible, the method should be benchmarked using a synthetic dataset (or other dataset where the
ground truth is known), and its utility on real data demonstrated."

Also surfaced: "many of the methods submitted to Genome Biology have a significant software component,
so would be appropriate either as Methodology or Software articles."

The closest thing to a direct Software/Brief-report criterion also surfaced in search of the guideline
text: a Brief Report "may be a visualization tool, software, or web-based application that would be
widely used in the field," and "examples of how the tool will be used should be provided." Both this
line and the Methodology quote above are search-surfaced renderings of the (now auth-walled) live
pages, so I weight them equally. The visualization-tool line points the same way as the precedent
papers: what is asked for is examples of use, not an equivalence study.

Two things matter here. First, even the strictest relevant criterion (Methodology) qualifies both the
side-by-side demonstration and the ground-truth benchmark with "where possible." It is a strong
preference, not an absolute gate. Second, a benchmark "using a synthetic dataset where the ground
truth is known" is a coherent ask for a method that computes a result (a caller, an aligner, a
normalizer). It maps poorly onto an interactive viewer/curation tool, where there is no single scalar
"correct answer" to score. The two accepted viewer papers above confirm the editors did not require
it of viewers.

FLAG (secondary/unverified): general web sources describe the Software/Brief-report route as
requiring the tool to be freely available under an OSI-compliant license, documented, installable, and
testable by reviewers, with "examples of how the tool will be used" provided, and a short format
(roughly 1000-1500 words, 2 figures/tables for a Brief report). Treat these specifics as unconfirmed
until fetched from the live page; the code-availability requirement is corroborated by the journal's
open-source-code policy but the word/figure limits are not primary-verified here.

---

## 4. Blunt verdict

A formal quantitative concordance/equivalence study against an incumbent desktop tool is NOT required
for Genome Biology Software acceptance. The evidence is the accepted papers themselves, not scope-page
rhetoric:

- Neither HiGlass (2018) nor JBrowse 2 (2023) contains an output-equivalence benchmark against any
  incumbent tool. Neither shows numeric agreement/accuracy of its rendering versus another browser.
- Both demonstrate their advance through the same recipe: worked examples/case studies on real data +
  capability breadth + a qualitative feature comparison against peers + open availability and
  reproducibility (shareable sessions, containers, source code).
- A quantitative benchmark does appear in JBrowse 2, but it is a SPEED/scalability benchmark
  (render time, frame rate vs igv.js and JBrowse 1), not an equivalence-of-output study. HiGlass has
  no comparative benchmark at all, only a single-tool latency usage stat.
- The journal's own strictest criterion (Methodology) asks for a side-by-side advance and a
  ground-truth benchmark only "where possible" - a preference, and one aimed at methods that produce
  scoreable output, not at interactive viewers.

Implication for the OpenPretext paper. Demonstration of utility is the norm and is sufficient: an
end-to-end worked curation case study (ideally reproducing PretextView's curated output on a real
assembly, shown qualitatively side by side), the breadth of capabilities, reproducibility
(curation-as-code / scriptable, shareable), and open availability. That case study reproducing the
incumbent's curated result IS the "side-by-side demonstration where possible" and lands squarely in
precedent. A formal quantitative concordance study (for example, cross-validating analytics against
cooltools, or scoring agreement of curated AGP against a reference curation) would strengthen the
submission and pre-empt a reviewer ask, but it is an enhancer, not a gate. Do not treat it as a
blocking requirement.

On the bonus item (a third/fourth GB Software example): deprioritized on purpose. HiGlass is itself a
browser-based Hi-C viewer, the direct analog of OpenPretext, so it is the strongest single precedent
available; JBrowse 2 is the strongest recent general-purpose browser precedent. A more distant third
tool would dilute rather than strengthen the argument, since the question is specifically about
interactive viewers/curation tools.

Caveats carried forward: (1) the exact article-type label for both precedent papers is unverified (see
framing note at top); (2) the live Software/Brief-report criteria could not be fetched verbatim
(Springer auth wall). The verdict rests primarily on what the two accepted precedent papers actually
contain, which is direct and strong, supported by the verified Methodology criterion and the
visualization-tool Brief-report line.
