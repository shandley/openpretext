# Evo2HiC Enhancement Server

A FastAPI server that provides Hi-C contact map resolution enhancement for OpenPretext.

Currently runs in **mock mode** -- applies Gaussian denoising, bicubic upscaling, and sharpening to produce plausible enhanced maps without requiring model weights. Replace with real Evo2HiC model weights when available.

## Prerequisites

- Python 3.11+
- [uv](https://docs.astral.sh/uv/) package manager

## Quick Start

```bash
cd server
uv sync
uv run evo2hic-server
```

The server starts on `http://localhost:8000`.

## API

### `GET /api/v1/health`

Returns server status and model info.

```json
{
  "status": "ok",
  "model_loaded": false,
  "device": "cpu",
  "model_version": "mock-0.1.0"
}
```

### `POST /api/v1/enhance`

Enhances a Hi-C contact map.

**Request body:**

| Field | Type | Description |
|---|---|---|
| `contact_map` | string | Base64-encoded Float32Array bytes |
| `map_size` | int | Side length of the square contact map |
| `fasta_sequences` | object \| null | Contig name to sequence mapping |
| `contig_names` | list \| null | Ordered contig names |
| `params.upscale_factor` | int | 4 (default) or 16 |
| `params.denoise` | bool | Apply denoising (default: true) |

**Response:**

| Field | Type | Description |
|---|---|---|
| `enhanced_map` | string | Base64-encoded enhanced Float32Array |
| `enhanced_size` | int | Side length of the enhanced map |
| `upscale_factor` | int | Applied upscale factor |
| `model_version` | string | Model version string |
| `elapsed_ms` | float | Processing time in milliseconds |

## Mock Mode vs Real Model

The server starts in mock mode by default (`model_loaded: false`). Mock enhancement applies:

1. Gaussian smoothing (noise reduction)
2. Bicubic interpolation (upscaling)
3. Unsharp mask (sharpening)
4. Symmetry enforcement

To use real model weights, implement the TODO sections in `evo2hic_server/inference.py`.

## GPU Acceleration

By default, PyTorch installs with CPU support. For GPU acceleration:

```bash
# CUDA 12.x
uv pip install torch --index-url https://download.pytorch.org/whl/cu124
```
