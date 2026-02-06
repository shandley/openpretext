# OpenPretext

A modern, web-based replacement for [PretextView](https://github.com/sanger-tol/PretextView) — the Wellcome Sanger Institute's Hi-C contact map viewer for genome assembly curation.

## Why?

PretextView is an essential tool used by hundreds of genome assembly teams worldwide (Darwin Tree of Life, Vertebrate Genomes Project, etc.) but it requires a 3-button mouse, runs only as a native desktop app, and has a dated interface. OpenPretext brings this to the browser.

## Features

- **WebGL2 rendering** — 60fps pan/zoom on the contact map
- **No 3-button mouse required** — works with trackpad
- **Keyboard-first** — all operations have shortcuts
- **Command palette** — Cmd+K for quick access
- **Scriptable curation** — every operation can be scripted
- **Annotation tracks** — overlay coverage, telomere, gap, repeat density
- **Modern UI** — dark theme, responsive, accessible

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000, then either:
- Click "Load Demo Data" to see a synthetic Hi-C map
- Drop a `.pretext` file onto the window

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `E` | Edit mode (cut/invert/move) |
| `S` | Scaffold painting mode |
| `W` | Waypoint mode |
| `L` | Toggle grid lines |
| `I` | Toggle info sidebar |
| `J` | Jump to diagonal |
| `↑/↓` | Cycle color maps |
| `←/→` | Adjust gamma |
| `⌘K` | Command palette |
| `⌘Z` | Undo |
| `⌘⇧Z` | Redo |
| `Home` | Reset view |
| `Esc` | Navigate mode |

## File Format Support

- `.pretext` — native format (DXT1 compressed textures)
- `.cool` / `.mcool` — planned
- `.hic` — planned

## Development

```bash
npm run dev       # Start dev server
npm test          # Run unit tests
npm run build     # Production build
```

## Architecture

See [AGENT_PROMPT.md](./AGENT_PROMPT.md) for full architecture documentation.

## License

MIT

## Acknowledgments

- [PretextView](https://github.com/sanger-tol/PretextView) by the Wellcome Sanger Institute
- [PretextMap](https://github.com/sanger-tol/PretextMap) for the `.pretext` format
- The Darwin Tree of Life and VGP communities
