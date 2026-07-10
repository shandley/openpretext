# OpenPretext field guide

A standalone conceptual guide to genome curation for newcomers: how to read a
Hi-C contact map, the common misassembly signatures, and the curation workflow.
It links into the app for the hands-on tutorials.

## Files

Two pages that share one stylesheet and one script. No build step.

- `index.html` main field guide (the newcomer on-ramp).
- `reading-the-analysis.html` the deeper page: what the 3D Analysis panel
  readouts mean, with interactive demos for contact decay, compartments, and
  the misassembly signatures. The app's analysis panel deep-links here, so keep
  the readout ids (`analysis-decay`, `analysis-health`, and so on) stable.
- `guide.css` shared styles for both pages.
- `guide.js` shared behavior: reveal-on-scroll, scrollspy, header offset, and
  the interactive demos. Each demo guards on its own root element, so it is
  harmless on pages that do not include it.
- `vercel.json` enables clean URLs so `/reading-the-analysis` resolves.

Deployed to Vercel at https://openpretext-guide.vercel.app

To redeploy after editing:

```bash
cd guide
vercel --prod
```
