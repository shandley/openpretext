# Contributing to OpenPretext

Thank you for your interest in contributing to OpenPretext! This guide will help
you get started.

## Development Setup

### Prerequisites

- Node.js 18 or later
- npm (included with Node.js)

### Getting Started

```bash
git clone https://github.com/shandley/openpretext.git
cd openpretext
npm install
npm run dev
```

The development server starts at http://localhost:3000 with hot module
replacement. Load a `.pretext` file or click "Load synthetic demo" from the
command palette (Cmd+K) to test your changes.

## Architecture Overview

OpenPretext is a single-page application with no UI framework dependencies.
See [CLAUDE.md](CLAUDE.md) for the full architecture reference, including
module descriptions, integration points, and common pitfalls.

Key principles:
- **No framework** — all UI is pure DOM manipulation (`src/ui/`)
- **WebGL2 rendering** — contact map displayed via GPU shaders
- **Single dependency** — only `pako` for deflate decompression
- **Background Workers** — heavy analysis runs in Web Workers
- **Typed events** — inter-module communication via `EventBus`

## Code Style

- TypeScript strict mode — no `any` types unless absolutely necessary
- JSDoc on public API functions; no comments on obvious code
- Track colors must use `#hex` format (e.g., `'#ff5050'`), not `rgb()`
- No comments on obvious code; comments only where logic is non-obvious

## Testing

```bash
npm test                # Run all 2,139 unit tests (vitest)
npx tsc --noEmit        # Type check (no output files)
npm run test:visual     # Run 35 E2E tests (Playwright + Chromium)
```

### Test conventions

- Test files live in `tests/unit/` and mirror source structure
  (e.g., `CurationEngine.ts` → `curation.test.ts`)
- Web Worker code is tested through the pure algorithm modules directly,
  not through the worker
- All tests must pass before merging

### Benchmarks

```bash
npm run bench:regression   # Run regression tests against stored baselines
```

## Common Patterns

### Singleton managers

`ContigExclusion`, `MisassemblyFlags`, and `MetaTagManager` follow the singleton
pattern. Call `clearAll()` when loading new data.

### Analysis modules

Analysis modules in `src/analysis/` are pure algorithms with no DOM dependencies:
1. Operate on the overview `contactMap` (Float32Array)
2. Produce `TrackConfig` objects for visualization
3. Run in the Web Worker via `AnalysisWorkerClient`
4. Fall back to synchronous execution when workers are unavailable

### Batch operations

Batch operations process indices **right-to-left** to maintain index stability
during cuts and joins.

## Adding a New Analysis Module

1. Create the pure algorithm in `src/analysis/NewAnalysis.ts`
   - Export a compute function and a `*ToTrack()` conversion function
   - Accept `contactMap: Float32Array` and `size: number` as inputs
   - Return a typed result object

2. Add worker integration:
   - Define request/response interfaces in `AnalysisWorker.ts`
   - Add a message handler case in the worker
   - Add a client method in `AnalysisWorkerClient.ts`

3. Add UI:
   - Add a compute button in `AnalysisPanel.ts`
   - Add cached state and clear logic
   - Wire the button click handler

4. Add export:
   - Add an export function in `AnalysisExport.ts`
   - Add an export button in the analysis panel

5. Add session persistence:
   - Add the result type to `SessionAnalysisData` in `SessionManager.ts`
   - Add export/restore logic in `AnalysisPanel.ts`

6. Write tests:
   - Create `tests/unit/new-analysis.test.ts`
   - Test the pure algorithm, edge cases, and track conversion

7. Update documentation:
   - Add the module to CLAUDE.md architecture and integration points sections
   - Update test counts in CLAUDE.md and README.md

## Adding a Tutorial Lesson

1. Create a JSON file in `data/lessons/` following the `LessonSchema` type
   in `src/data/LessonSchema.ts`
2. Reference a specimen from `data/specimen-catalog.json` via `specimenId`
3. Use supported `expectedAction` types: `zoom`, `select-contig`, `cut`,
   `join`, `invert`, `navigate`, `mode-change`, `auto-sort`, `auto-cut`,
   `observe`
4. For assessment lessons, generate ground truth orderings using:
   ```bash
   npx tsx bench/extract-lesson-ground-truth.ts <curated.pretext>
   ```

## Pull Request Guidelines

- Write descriptive commit messages (what and why, not just what)
- All unit tests must pass (`npm test`)
- Type check must pass (`npx tsc --noEmit`)
- Include test coverage for new code
- Update CLAUDE.md for architectural changes
- Update README.md for user-facing feature additions
- Keep PRs focused — one feature or fix per PR when possible

## Reporting Issues

Please report bugs and feature requests at
https://github.com/shandley/openpretext/issues

Include:
- Browser and OS version
- Steps to reproduce
- Expected vs actual behavior
- Console errors (if any)
