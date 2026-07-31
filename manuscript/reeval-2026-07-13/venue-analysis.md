# OpenPretext venue analysis

Date: 2026-07-13
Question: What is the realistic best-fit journal for OpenPretext, and can it credibly aim above a Bioinformatics Application Note?

Method: every journal scope, article type, and precedent below was verified against a real fetched page (publisher site, PMC, Crossref, or the journal's own author-guidelines). URLs are cited inline. Items that could not be verified from a primary source are marked UNVERIFIED.

---

## Verdict (read this first)

Yes, OpenPretext can credibly aim above a Bioinformatics Application Note. The precedent is direct and verified: two browser-based genome/Hi-C viewers with no novel algorithm (HiGlass, JBrowse 2) both published as Software papers in Genome Biology.

But "can aim above" is not "clears the bar as-is." Given the honest profile (impact-not-novelty, re-implemented analytics, no adoption metrics yet), the split is:

- Realistic best target (best odds for a genuine step-up): GigaScience Research/technical article. Its stated selection criterion (reproducibility, usability, utility, not impact) is the closest fit to OpenPretext as it stands today.
- Realistic ceiling (reachable, precedented, but a stretch): Genome Biology Software. HiGlass and JBrowse 2 prove the venue accepts browser tools without new algorithms, but GB requires a side-by-side demonstration of a clear advance over the state of the art, which OpenPretext does not yet have.
- Gated / not reachable now: PLOS Computational Biology (fails a quoted, explicit adoption gate) and NAR Web Server (eligibility for a purely client-side app is genuinely unresolved in the written rules).
- Floor / fallback (below the goal): Bioinformatics Application Note. Safe, precedented for exactly this tool class, but it is the outcome we are trying to beat.

A non-obvious point that helps: OpenPretext's honest profile fits Genome Biology Software's bar *better* than it fits a Bioinformatics Original Paper. GB Software rewards a novel *application* and explicitly does not require biological novelty; a Bioinformatics Original Paper leans toward software with novel *methods*, which OpenPretext does not claim.

---

## Part 1: Precedent (where comparable tools actually published)

The pattern across verified precedents: contact-map viewers and established browsers reach the top tier (Genome Biology, NAR) as tool/resource papers, not method papers. Assembly QC/curation viewers more often land one tier down (Bioinformatics, G3, PeerJ). No browser-based Hi-C curation tool has ever been formally peer-reviewed.

### Direct analogues (Hi-C viewers and analysis)

| Tool | Venue / year | Article type | Method or tool? | Adoption shown? | Verified URL |
|---|---|---|---|---|---|
| HiGlass (Kerpedjiev et al.) | Genome Biology 2018 | Software | Tool/resource (web Hi-C viewer, no new algorithm) | Framed as broadly useful | https://genomebiology.biomedcentral.com/articles/10.1186/s13059-018-1486-1 (full text via d-nb.info published PDF: https://d-nb.info/1169395244/34) |
| FAN-C (Kruse et al.) | Genome Biology 2020 | Software/research | Tool/toolkit; integrates existing algorithms (insulation, HICCUPS) | Aspirational only | https://pmc.ncbi.nlm.nih.gov/articles/PMC7745377/ |
| cooler (Abdennur & Mirny) | Bioinformatics 2020, Original Paper | Original Paper (Data and Text Mining) | Novel sparse data format + library | Strong: 4D Nucleome standard; used by HiGlass, WashU browser | https://academic.oup.com/bioinformatics/article/36/1/311/5530598 |
| cooltools (Open2C) | PLOS Computational Biology 2024 | Software | Tool suite, not a new method | Strong: documented cross-taxa usage | https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1012067 |
| Juicebox (Durand et al.) | Cell Systems 2016 | Short tool paper | Tool (desktop viewer) | Hosted data from 15+ papers | https://pmc.ncbi.nlm.nih.gov/articles/PMC5596920/ |
| Juicebox.js (Robinson et al.) | Cell Systems 2018 | Short tool/resource | Tool (web viewer) | ENCODE / 4D Nucleome format adoption | https://pmc.ncbi.nlm.nih.gov/articles/PMC6047755/ |
| Juicebox Assembly Tools (JBAT, Dudchenko et al.) | bioRxiv 2018, PREPRINT ONLY | Preprint (never peer-reviewed) | Assembly-curation tool | n/a | Crossref metadata: https://api.crossref.org/works/10.1101/254797 |

Key reading: the two viewers most analogous to OpenPretext (HiGlass, Juicebox/Juicebox.js) published as tool/resource papers, not method papers. cooler is the outlier that led with a novel format and rode consortium adoption. The closest analogue to OpenPretext's actual role, browser-based assembly curation (JBAT), never cleared peer review.

### Web genome browsers and assembly tools in the target tier (2017-2026)

Verified in the target journals:

- JBrowse 2, Genome Biology 24:74 (2023). Software/tool. Explicitly "a complete rewrite," not a novel method. Successor to widely-used JBrowse. https://pmc.ncbi.nlm.nih.gov/articles/PMC10108523/
- Merqury, Genome Biology 21:245 (2020). Assembly QC tool; VGP/EBP standard. https://pmc.ncbi.nlm.nih.gov/articles/PMC7488777/
- WashU Epigenome Browser update, NAR 47(W1):W158 (2019), Web Server issue. Resource update. https://academic.oup.com/nar/article/47/W1/W158/5511467
- UCSC Genome Browser database 2023 update, NAR 51(D1):D1188 (2023), Database issue. Resource update. https://academic.oup.com/nar/article/51/D1/D1188/6845436
- Howe et al., "Significantly improving the quality of genome assemblies through curation," GigaScience 10(1):giaa153 (2021). The canonical Sanger manual-curation paper; names gEVAL, PretextView, HiGlass. Classified as a Review, not a software paper. https://academic.oup.com/gigascience/article/10/1/giaa153/6072294

Verified but one tier down (calibration for where assembly viewers usually land):

- igv.js, Bioinformatics 39(1):btac830 (2023), Applications Note. https://academic.oup.com/bioinformatics/article/39/1/btac830/6958554
- gEVAL, Bioinformatics 32(16):2508 (2016), Applications Note. Sanger web-based assembly-evaluation browser. https://academic.oup.com/bioinformatics/article/32/16/2508/1743061
- BlobToolKit, G3 10(4):1361 (2020). Browser-based assembly QC/contamination viewer. https://academic.oup.com/g3journal/article/10/4/1361/6026202
- D-GENIES, PeerJ 6:e4958 (2018). Web app for genome-comparison dot plots. https://peerj.com/articles/4958/
- purge_dups, Bioinformatics 36(9):2896 (2020). Haplotig removal (CLI). https://academic.oup.com/bioinformatics/article/36/9/2896/5714742

### The PretextView finding (the gap OpenPretext fills)

PretextView has no formal journal publication. Confirmed by fetching the sanger-tol/PretextView GitHub README: no "how to cite," no DOI, no Zenodo deposit, no reference to a peer-reviewed paper for PretextView itself. It appears in the literature only by mention inside the Howe et al. 2021 GigaScience review. Source: https://github.com/sanger-tol/PretextView

Combined with JBAT being preprint-only, this means: no peer-reviewed, browser-based Hi-C assembly-curation tool exists. "First peer-reviewed browser-native genome-curation tool" is a legitimate contribution-novelty claim, and it is the strongest single argument for aiming above an Application Note.

UNVERIFIED precedents (flagged, do not cite without checking): AssemblyQC venue (only a ResearchGate reference found); Bandage (commonly Bioinformatics 2015, outside window, not fetched this pass); tapestry (not checked).

---

## Part 2: Scope and eligibility of the step-up venues

### Genome Biology, Software article type

Exists, with a demanding bar. Verified wording:

> "Software articles in Genome Biology should describe novel software applications that are likely to be of broad utility and that are shown to be a clear advance over the state-of-the-art existing tools in a side-by-side demonstration using the same dataset."

> "A Software article need not necessarily provide novel biological insights, but these can help to demonstrate the method's utility."

Requirements: novel application, broad utility, a demonstrated clear advance over existing tools shown side by side on the same dataset, and public source code under an OSI-compliant license.

Fit for OpenPretext: the novelty-of-application framing and the "biological insight not required" clause fit OpenPretext well. The load-bearing hurdle is the side-by-side demonstration of a clear advance. OpenPretext's advance is accessibility, reproducibility, and scriptability, not accuracy, so the "advance" has to be argued on those axes against PretextView/Juicebox on the same assembly. Reachable, not automatic.

- URL: https://genomebiology.biomedcentral.com/submission-guidelines/preparing-your-manuscript/software (redirects to https://link.springer.com/journal/13059/submission-guidelines/software)
- PROVENANCE FLAG: the direct fetch was auth-blocked by Springer; the quotes were retrieved via a text-extraction proxy of the official page. Wording is genuine but confirm against the live page in a browser before quoting in the manuscript.
- Word limit / structure for Software articles: UNVERIFIED (not stated on the article-type page; third-party "3,000-5,000 words" figures are non-official).

### NAR Web Server issue (decisive eligibility question)

The eligibility rules do not use the words "server-side" and do not state where computation must physically run. The hinge is whether a user can analyse their own submitted data through a browser. Verified wording:

> "Nucleic Acids Research devotes a single issue in July to papers describing web-based software resources of value to the biological community."

> "Access to the server must be through a web browser."

A qualifying tool must NOT:

> "be mere portals for download or visualisation of static data without the option to analyse user data."

And, importantly for OpenPretext's tool class:

> "Stand-Alone applications for high-throughput data analysis are no longer covered by the Web Server Issue, please submit them as Standard articles to the 'Computational Biology' section."

Free/open requirement, one of which must appear on the site and in the manuscript:

> "This website is free and open to all users and there is no login requirement."

Assessment for OpenPretext, MEDIUM confidence, UNRESOLVED: the literal criteria neither require server-side computation nor explicitly endorse client-side-only computation. The operative test is "the option to analyse user data" accessed "through a web browser," which a client-side app satisfies, and OpenPretext is clearly more than a "mere portal for visualisation of static data." But there is a real risk on two fronts: (1) no NAR sentence blesses browser-only, no-server tools, so an editor could read "web server" literally; and (2) the exclusion of "stand-alone applications" could be argued to capture a client-side app that runs entirely in the user's browser. This ambiguity is the single item most worth a direct pre-submission inquiry to the NAR editors. Do not treat NAR Web Server as a confirmed fit.

- URL: https://academic.oup.com/nar/pages/submission_webserver
- UNVERIFIED: the often-cited four-part pre-approval criterion (quality, wide interest, computation on user-submitted data, well-designed site) came from a search snippet, not a direct-fetch quote of the live page.

### GigaScience (flagship, not GigaByte)

Scope and criteria fit OpenPretext's profile better than any other step-up venue. Verified wording:

> "'big data' research from the life and biomedical sciences. Research Articles present work utilising large scale data that provide some scientific insight and conclusions."

Reproducibility is an explicit review criterion:

> "Ease of reproducibility is one of the key criteria on which reviewers will be asked to comment ... we strongly advocate the use of the reporting checklists ... and workflow management systems such as Galaxy and container systems such as Docker."

Selection philosophy (from the About page):

> "reproducibility, usability and utility, rather than subjective assessment of 'impact'."

Article-type caveat: GigaScience's Technical Note type is verified-narrow ("Technical notes present novel data formats that facilitate the interoperability of bioinformatics tools"), which OpenPretext is not. A Research Article wants "scientific insight and conclusions," which for a tool means a real curation result, not just a feature tour. This is why a curation case study is the pivotal addition (see below). GigaScience has no live-server requirement; it is a resource/reproducibility journal.

- URLs: https://academic.oup.com/gigascience/pages/research ; https://academic.oup.com/gigascience/pages/instructions_to_authors ; https://academic.oup.com/gigascience/pages/technical_note
- UNVERIFIED: the "reproducibility, usability and utility, rather than ... impact" quote came from a search snippet of the About page, not a direct fetch.
- GigaByte (the shorter companion) differs: short-format, rapid, questionnaire-style review, data/software-centric. Not the target for a large tool paper.

### Bioinformatics, Original Paper vs Application Note

Verified from the official author guidelines (https://academic.oup.com/bioinformatics/pages/author-guidelines):

- Original Paper: "Up to 7 pages; this is approx. 5,000 words," for new research developments in computational biology (models, algorithms, software with novel methods), validated on real biological data.
- Application Note: "Up to 4 pages; this is approx. 2,600 words or 2,000 words plus one figure," for "short descriptions of novel software or new algorithm implementations, databases and network services." Gated on the software being freely available, functional at submission, and maintained two years.

Fit for OpenPretext: the Application Note is the natural floor and is well-precedented for this exact tool class (igv.js, gEVAL). An Original Paper leans toward novel methods, which OpenPretext does not claim, so it is a weaker fit than GB Software despite being the same publisher tier.

### PLOS Computational Biology, Software article type

Exists, but with an adoption gate OpenPretext currently fails. Verified wording:

> "an open-source tool of broad utility that represents a significant advance in providing new biological insights"

> [the software must] "already be widely adopted, or have the promise of wide adoption by a broad community of users"

Enhancements to existing software qualify only if they bring "exceptional new capabilities."

Fit for OpenPretext: poor right now. The adoption clause is explicit and OpenPretext has no adoption metrics yet. cooltools cleared this bar with documented cross-taxa usage; OpenPretext cannot make the same case today. Revisit only after real adoption exists.

- URL: https://journals.plos.org/ploscompbiol/s/submission-guidelines
- PARTIALLY UNVERIFIED: the exact word count and section list were the fetch model's reading of the page; the core Software criteria quotes above are solid.

---

## Ranked recommendation (safest to most ambitious)

1. Bioinformatics Application Note. FLOOR / high odds, but below the goal. Precedent: igv.js (2023), gEVAL (2016), both Application Notes for browser-based assembly/genome viewers. Safe landing spot if a step-up fails. This is the outcome we are trying to beat, so treat it as the fallback, not the plan.

2. GigaScience Research article. BEST-ODDS STEP-UP. Its stated selection philosophy (reproducibility, usability, utility, not impact) is the closest match to OpenPretext's honest profile, and it is the venue whose bar the tool most nearly clears as-is. Precedent: it is the home of the canonical genome-curation literature (Howe et al. 2021) and rewards reproducibility, which OpenPretext's curation-as-code DSL/CLI directly serves. Needs: a real curation case study with scientific conclusions (not just a feature tour) to qualify as a Research Article rather than a Data Note.

3. Genome Biology Software. CEILING / reachable stretch. Precedent is strong and direct: HiGlass (2018) and JBrowse 2 (2023) are browser tools with no novel algorithm, published as GB Software. The honest profile fits GB Software's "novel application, biological insight not required" framing better than it fits a Bioinformatics Original Paper. The gating hurdle is the required side-by-side demonstration of a clear advance over the state of the art on the same dataset. Odds are moderate today, good with the additions below.

4. NAR Web Server (gated, unresolved) and PLOS Computational Biology (gated, fails adoption clause). Do not target either without new evidence. NAR needs a resolution of the client-side-only eligibility question (a direct editor inquiry). PLOS needs demonstrated wide adoption, which does not exist yet.

---

## What OpenPretext would need to add to reach each step up

These are ranked by leverage; the first two unlock the most.

1. An end-to-end curation case study on a real assembly, ideally reproducing PretextView's curation output on the same genome. This is the highest-leverage addition. It simultaneously supplies Genome Biology's required side-by-side demonstration and gives GigaScience the "scientific insight and conclusions" a Research Article needs. Without it, GB Software is out of reach and GigaScience risks being classed as a Data Note.

2. Numerical cross-validation that the re-implemented analytics (insulation, P(s) decay, compartments, ICE/KR balancing) match the published reference implementations within a stated tolerance. This converts "re-implementations, not novel" from a weakness into a documented correctness claim, and it is the kind of rigor GB and GigaScience reviewers expect.

3. A curation-as-code reproducibility demonstration: the DSL/headless CLI re-running a full curation deterministically from a script. This is a near-exact match to GigaScience's reproducibility review criterion (checklists, containerized/scripted workflows) and is a differentiator no prior curation tool has.

4. Adoption evidence: named genome teams (DToL, VGP, EBP) using it, download/usage counts, or curations shipped with it. Required for PLOS Computational Biology's explicit adoption gate, strengthens Genome Biology, and would materially raise the odds everywhere. This is the item that separates "reachable" from "safe" at the ceiling.

5. For NAR only: a direct pre-submission inquiry to the editors on whether a purely client-side browser application qualifies for the Web Server issue. The written rules do not resolve it.

---

## Provenance and verification flags (fact-discipline record)

- Genome Biology Software wording: retrieved via text-extraction proxy of the official Springer page because the primary host auth-blocks automated fetches. Genuine, but confirm on the live page before quoting in the manuscript. GB Software word limit/structure: UNVERIFIED.
- NAR four-part pre-approval criterion: from a search snippet, not a direct-fetch quote. The client-side-only eligibility question is genuinely unresolved in the written rules (MEDIUM confidence, flagged as the decisive open item).
- GigaScience "reproducibility, usability and utility, rather than impact": from a search snippet of the About page, not a direct fetch. The Research/Technical Note/Data Note scope quotes are direct-fetch.
- PLOS Comp Biol Software criteria quotes: direct-fetch and solid; exact word count and section list: PARTIALLY UNVERIFIED.
- Bioinformatics Original Paper vs Application Note: fully verified from the official OUP host.
- HiGlass article number and purge_dups DOI: not independently re-fetched; journal, year, and type confirmed.
- Precedents not verified this pass: AssemblyQC venue, Bandage, tapestry.
