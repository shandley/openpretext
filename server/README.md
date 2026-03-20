# Evo2HiC Enhancement Server

A FastAPI server that provides Hi-C contact map resolution enhancement for OpenPretext.

Supports two modes:
- **Mock mode** (default) -- Gaussian denoising, bicubic upscaling, and sharpening
- **Real model** -- loads weights from the [CHNFTQ/Evo2HiC](https://github.com/CHNFTQ/Evo2HiC) repository

## Prerequisites

- Python 3.11+
- [uv](https://docs.astral.sh/uv/) package manager

## Quick Start (Mock Mode)

```bash
cd server
uv sync
uv run evo2hic-server
```

The server starts on `http://localhost:8000`.

## Running with Real Model Weights

### 1. Clone the Evo2HiC repository

```bash
git clone https://github.com/CHNFTQ/Evo2HiC.git /path/to/Evo2HiC
```

### 2. Download model weights

Download the pretrained checkpoint from Zenodo (DOI: [10.5281/zenodo.17917912](https://doi.org/10.5281/zenodo.17917912)). Extract so you have a directory containing both a `.pt` checkpoint file and an `args.json` file.

### 3. Set environment variables and run

```bash
export EVO2HIC_REPO_PATH=/path/to/Evo2HiC
export EVO2HIC_CHECKPOINT=/path/to/checkpoint/best_model.pt

cd server
uv sync
uv run evo2hic-server
```

The server will log whether it loaded the real model or fell back to mock mode. If loading fails (missing dependencies, bad checkpoint, etc.), it automatically falls back to mock inference with a warning.

### GPU acceleration

The server auto-detects the best available device: **CUDA** (NVIDIA) > **MPS** (Apple Silicon) > CPU.

**Apple Silicon (M1/M2/M3/M4):** MPS is supported out of the box — no extra setup needed. The default PyTorch install includes MPS support. Enhancement speedup: ~18× vs CPU.

**NVIDIA GPU:**
```bash
# Install PyTorch with CUDA 12.x support
uv pip install torch --index-url https://download.pytorch.org/whl/cu124
```

Check which device is active via the health endpoint:
```bash
curl http://localhost:8000/api/v1/health
# {"status":"ok","model_loaded":true,"device":"mps",...}
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `EVO2HIC_REPO_PATH` | Path to cloned CHNFTQ/Evo2HiC repository | None (mock mode) |
| `EVO2HIC_CHECKPOINT` | Path to `.pt` checkpoint file | None (mock mode) |

Both must be set for real model inference. If either is missing, the server runs in mock mode.

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

When running with real weights, `model_loaded` will be `true` and `model_version` will reflect the checkpoint name.

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

## How Real Inference Works

1. The contact map is normalized using the checkpoint's `Normalizer` (normalization type and parameters stored in `args.json`)
2. For small maps (up to 256 pixels), the entire map is padded to a multiple of the model's chunk size (typically 100 bins) and processed in a single forward pass
3. For larger maps, the map is split into overlapping tiles, each processed independently, then reassembled with overlap blending
4. DNA and mappability embeddings are set to empty tensors, which triggers the model's built-in zero-embedding fallback (the model was trained with DNA dropout)
5. Output is unnormalized, clipped to non-negative values, and symmetrized
6. Optional upscaling via bicubic interpolation is applied after model inference
