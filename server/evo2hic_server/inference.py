"""Evo2HiC model inference with real model support.

Supports two modes:
1. **Real model** -- loads weights from a CHNFTQ/Evo2HiC checkpoint when
   EVO2HIC_REPO_PATH and EVO2HIC_CHECKPOINT environment variables are set.
2. **Mock mode** (default) -- applies Gaussian smoothing, bicubic upscaling,
   and mild sharpening to produce plausible enhanced maps without model weights.
"""

from __future__ import annotations

import json
import logging
import math
import os
import sys
from pathlib import Path

import numpy as np
import torch
from scipy.ndimage import gaussian_filter, zoom

from .schemas import EnhanceParams

logger = logging.getLogger(__name__)

# Environment variables for real model support
EVO2HIC_REPO_PATH = os.environ.get("EVO2HIC_REPO_PATH")
EVO2HIC_CHECKPOINT = os.environ.get("EVO2HIC_CHECKPOINT")

MODEL_VERSION = "mock-0.1.0"
MODEL_LOADED = False

# Default chunk size the Evo2HiC model expects (bins at 2kb resolution)
DEFAULT_CHUNK_SIZE = 100
# Overlap for tiling large maps (in bins)
TILE_OVERLAP = 10
# Threshold for whole-map vs tiled inference
WHOLE_MAP_THRESHOLD = 256


def _ensure_evo2hic_importable() -> bool:
    """Add the Evo2HiC repo to sys.path if configured and available."""
    if EVO2HIC_REPO_PATH is None:
        return False
    repo = Path(EVO2HIC_REPO_PATH)
    if not repo.is_dir():
        logger.warning("EVO2HIC_REPO_PATH=%s is not a directory", EVO2HIC_REPO_PATH)
        return False
    repo_str = str(repo.resolve())
    if repo_str not in sys.path:
        sys.path.insert(0, repo_str)
    return True


class Evo2HiCModel:
    """Hi-C contact map enhancement model.

    Loads real CHNFTQ/Evo2HiC weights when configured, otherwise falls back
    to mock enhancement.
    """

    def __init__(self) -> None:
        self.device: str = "cpu"
        self.model: torch.nn.Module | None = None
        self.normalizer: object | None = None
        self.model_args: dict | None = None
        self.chunk_size: int = DEFAULT_CHUNK_SIZE
        self._loaded = False

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    def load_model(
        self,
        checkpoint_path: str | None = None,
        device: str | None = None,
    ) -> None:
        """Load model weights from checkpoint.

        Args:
            checkpoint_path: Path to model checkpoint file. If None, checks
                EVO2HIC_CHECKPOINT env var. Falls back to mock if neither set.
            device: Torch device string (e.g. "cpu", "cuda:0"). Auto-detected
                if None.
        """
        if device is None:
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
        else:
            self.device = device

        # Resolve checkpoint path from argument or environment
        ckpt = checkpoint_path or EVO2HIC_CHECKPOINT

        if ckpt is not None:
            try:
                self._load_real_model(ckpt)
                return
            except Exception:
                logger.exception(
                    "Failed to load real Evo2HiC model from %s; "
                    "falling back to mock inference",
                    ckpt,
                )

        # Mock mode -- no weights needed
        logger.info("Running in mock inference mode")
        self._loaded = False

    def _load_real_model(self, checkpoint_path: str) -> None:
        """Load the real CHNFTQ/Evo2HiC model from a checkpoint.

        Follows the same loading pattern as inference_CDNA2d.py:load_model().
        Requires EVO2HIC_REPO_PATH to be set so the model code is importable.
        """
        if not _ensure_evo2hic_importable():
            raise RuntimeError(
                "EVO2HIC_REPO_PATH is not set or invalid. "
                "Cannot import Evo2HiC model code."
            )

        # Resolve symlinks (matches the original repo behavior)
        try:
            ckpt = os.readlink(checkpoint_path)
        except OSError:
            ckpt = checkpoint_path

        if not os.path.isfile(ckpt):
            raise FileNotFoundError(f"Checkpoint not found: {ckpt}")

        # Load args.json from the same directory as the checkpoint
        args_file = os.path.join(os.path.dirname(ckpt), "args.json")
        if not os.path.isfile(args_file):
            raise FileNotFoundError(
                f"args.json not found next to checkpoint: {args_file}"
            )

        with open(args_file) as f:
            args = json.load(f)

        self.model_args = args

        # Import Evo2HiC modules (now on sys.path)
        from dataset.normalizer import Normalizer  # type: ignore[import-untyped]
        from model.create_CDNA2d import create_model  # type: ignore[import-untyped]

        # Build normalizer
        self.normalizer = Normalizer(
            args["normalization"],
            max_reads=args["max_reads"],
            denominator=args["denominator"],
            step=args["step"],
        )

        # Create model architecture (diffusion_steps=0 for inference)
        model = create_model(
            **{**args, "normalizer": self.normalizer, "diffusion_steps": 0}
        )

        # Load state dict with unet->decoder key remapping
        state = torch.load(ckpt, map_location="cpu", weights_only=True)
        state_unified = {
            k.replace("unet", "decoder"): v
            for k, v in state["model"].items()
        }
        model.load_state_dict(state_unified)

        model.to(self.device)
        model.eval()

        self.model = model
        self._loaded = True

        # Extract chunk size from model args if available
        if "chunk_size" in args:
            self.chunk_size = args["chunk_size"]

        global MODEL_VERSION, MODEL_LOADED
        MODEL_VERSION = f"evo2hic-{Path(ckpt).stem}"
        MODEL_LOADED = True

        logger.info(
            "Loaded real Evo2HiC model from %s (device=%s, chunk_size=%d)",
            ckpt,
            self.device,
            self.chunk_size,
        )

    def enhance(
        self,
        contact_map: np.ndarray,
        size: int,
        fasta: dict[str, str] | None = None,
        params: EnhanceParams | None = None,
    ) -> tuple[np.ndarray, int]:
        """Enhance a Hi-C contact map.

        Args:
            contact_map: Flattened float32 contact map (size * size elements).
            size: Side length of the square contact map.
            fasta: Optional contig name -> sequence mapping.
            params: Enhancement parameters.

        Returns:
            Tuple of (enhanced flattened float32 array, new side length).
        """
        if params is None:
            params = EnhanceParams()

        matrix = contact_map.reshape(size, size).astype(np.float64)

        if self._loaded and self.model is not None and self.normalizer is not None:
            return self._real_enhance(matrix, params)

        return self._mock_enhance(matrix, params)

    # ------------------------------------------------------------------
    # Real model inference
    # ------------------------------------------------------------------

    def _real_enhance(
        self,
        matrix: np.ndarray,
        params: EnhanceParams,
    ) -> tuple[np.ndarray, int]:
        """Run real Evo2HiC model inference.

        For small overview maps (≤ WHOLE_MAP_THRESHOLD), processes the entire
        map at once with padding. For larger maps, uses overlapping tiles.
        """
        assert self.model is not None
        assert self.normalizer is not None

        size = matrix.shape[0]

        # Normalize the contact map
        normalized = self.normalizer.normalize(matrix)  # type: ignore[union-attr]

        if size <= WHOLE_MAP_THRESHOLD:
            enhanced_norm = self._infer_whole_map(normalized, size)
        else:
            enhanced_norm = self._infer_tiled(normalized, size)

        # Unnormalize the output
        enhanced = self.normalizer.unnormalize(enhanced_norm)  # type: ignore[union-attr]
        enhanced = np.clip(enhanced, 0, None)

        # Enforce symmetry
        enhanced = (enhanced + enhanced.T) / 2.0

        # Apply upscaling if requested (model output is same resolution)
        factor = params.upscale_factor
        if factor > 1:
            enhanced = zoom(enhanced, factor, order=3)

        new_size = enhanced.shape[0]
        result = enhanced.astype(np.float32).ravel()
        return result, new_size

    def _infer_whole_map(
        self,
        normalized: np.ndarray,
        size: int,
    ) -> np.ndarray:
        """Process the entire map as a single input, padding to chunk_size."""
        chunk = self.chunk_size
        padded_size = math.ceil(size / chunk) * chunk

        # Pad with zeros to nearest multiple of chunk_size
        padded = np.zeros((padded_size, padded_size), dtype=np.float64)
        padded[:size, :size] = normalized

        output = self._run_model_on_tile(padded)

        # Crop back to original size
        return output[:size, :size]

    def _infer_tiled(
        self,
        normalized: np.ndarray,
        size: int,
    ) -> np.ndarray:
        """Process a large map using overlapping tiles."""
        chunk = self.chunk_size
        overlap = TILE_OVERLAP
        stride = chunk - overlap

        # Pad to ensure full coverage
        padded_size = math.ceil(size / stride) * stride + overlap
        padded = np.zeros((padded_size, padded_size), dtype=np.float64)
        padded[:size, :size] = normalized

        output = np.zeros((padded_size, padded_size), dtype=np.float64)
        weights = np.zeros((padded_size, padded_size), dtype=np.float64)

        # Process each tile
        for row in range(0, padded_size - overlap, stride):
            for col in range(0, padded_size - overlap, stride):
                r_end = min(row + chunk, padded_size)
                c_end = min(col + chunk, padded_size)

                # Extract tile (may be smaller than chunk at edges)
                tile = np.zeros((chunk, chunk), dtype=np.float64)
                tile_h = r_end - row
                tile_w = c_end - col
                tile[:tile_h, :tile_w] = padded[row:r_end, col:c_end]

                # Run model
                result = self._run_model_on_tile(tile)

                # Accumulate with blending weights (fade at overlaps)
                w = np.ones((chunk, chunk), dtype=np.float64)
                if overlap > 0:
                    # Fade the overlap edges
                    for i in range(overlap):
                        fade = (i + 1) / (overlap + 1)
                        if row > 0:
                            w[i, :] *= fade
                        if col > 0:
                            w[:, i] *= fade

                output[row:r_end, col:c_end] += result[:tile_h, :tile_w] * w[:tile_h, :tile_w]
                weights[row:r_end, col:c_end] += w[:tile_h, :tile_w]

        # Normalize by accumulated weights
        mask = weights > 0
        output[mask] /= weights[mask]

        return output[:size, :size]

    def _run_model_on_tile(self, tile: np.ndarray) -> np.ndarray:
        """Run the model forward pass on a single tile.

        Constructs the input dict expected by CDNA2d.forward():
        - input_matrix: (batch=1, S=1, H=1, channels=1, height, width)
        - DNA_row / DNA_col: empty tensors (triggers zero-embedding fallback)
        - mappability_row / mappability_col: empty tensors
        """
        assert self.model is not None

        h, w = tile.shape

        # Model expects shape: (batch, S, H, channels, height, width)
        # S and H are sub-matrix grid dimensions; for single tile, both = 1
        input_tensor = (
            torch.from_numpy(tile)
            .float()
            .unsqueeze(0)  # channels
            .unsqueeze(0)  # H
            .unsqueeze(0)  # S
            .unsqueeze(0)  # batch
        )

        data = {
            "input_matrix": input_tensor.to(self.device),
            # Empty tensors for DNA/mappability trigger zero-embedding
            # fallback in CDNA2d.forward()
            "DNA_row": torch.empty(0).to(self.device),
            "DNA_col": torch.empty(0).to(self.device),
            "mappability_row": torch.empty(0).to(self.device),
            "mappability_col": torch.empty(0).to(self.device),
        }

        with torch.no_grad():
            output = self.model(**data)

        # Output shape: (batch, S, H, channels, height, width)
        result = output.flatten(0, 2)[:, 0, :, :].cpu().numpy()
        return result[0]

    # ------------------------------------------------------------------
    # Mock inference (fallback)
    # ------------------------------------------------------------------

    def _mock_enhance(
        self,
        matrix: np.ndarray,
        params: EnhanceParams,
    ) -> tuple[np.ndarray, int]:
        """Mock enhancement: denoise, upscale, sharpen.

        Produces a plausible "enhanced" map by:
        1. Gaussian smoothing to reduce noise
        2. Bicubic upscaling to target resolution
        3. Mild unsharp-mask sharpening
        4. Symmetry enforcement
        """
        factor = params.upscale_factor

        # Step 1: Denoise with Gaussian smoothing
        if params.denoise:
            sigma = 0.8
            matrix = gaussian_filter(matrix, sigma=sigma)

        # Step 2: Upscale with bicubic interpolation
        upscaled = zoom(matrix, factor, order=3)
        new_size = upscaled.shape[0]

        # Step 3: Sharpen with unsharp mask
        blurred = gaussian_filter(upscaled, sigma=1.0)
        sharpened = upscaled + 0.3 * (upscaled - blurred)

        # Step 4: Enforce symmetry (Hi-C maps are symmetric)
        symmetric = (sharpened + sharpened.T) / 2.0

        # Clamp to non-negative values
        symmetric = np.maximum(symmetric, 0.0)

        result = symmetric.astype(np.float32).ravel()
        return result, new_size
