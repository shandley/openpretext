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

from .dna_encoder import prepare_dna_for_tile, prepare_dna_tensor, prepare_mappability_tensor
from .schemas import EnhanceParams

logger = logging.getLogger(__name__)

# Environment variables for real model support
EVO2HIC_REPO_PATH = os.environ.get("EVO2HIC_REPO_PATH")
EVO2HIC_CHECKPOINT = os.environ.get("EVO2HIC_CHECKPOINT")

EVO2HIC_EPI_CHECKPOINT = os.environ.get("EVO2HIC_EPI_CHECKPOINT")

MODEL_VERSION = "mock-0.1.0"
MODEL_LOADED = False
EPI_MODEL_LOADED = False

# Default chunk size the Evo2HiC model expects (bins at 2kb resolution)
DEFAULT_CHUNK_SIZE = 100


def _detect_device() -> str:
    """Auto-detect the best available torch device.

    Priority: CUDA (NVIDIA GPU) > MPS (Apple Silicon GPU) > CPU.
    """
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"
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
            self.device = _detect_device()
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

        # Supply defaults for args that create_model expects but
        # aren't stored in args.json (they come from argparse defaults)
        model_defaults = {
            "input_channels": args.get("num_channels", 1),
            "output_channels": args.get("num_channels", 1),
            "dim": args.get("unet_input_dim", 128),
            "force_final_conv": args.get("force_final_conv", False),
            "use_mrcrossembed": args.get("use_mrcrossembed", True),
            "encoder_version": args.get("encoder_version", "v1"),
        }

        # Create model architecture (diffusion_steps=0 for inference)
        model = create_model(
            **{**model_defaults, **args, "normalizer": self.normalizer, "diffusion_steps": 0}
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

        # Extract chunk size from model args (key is "chunk" in args.json)
        if "chunk" in args:
            self.chunk_size = args["chunk"]
        elif "chunk_size" in args:
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
        contig_names: list[str] | None = None,
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
            return self._real_enhance(
                matrix, params,
                fasta_sequences=fasta,
                contig_names=contig_names,
            )

        return self._mock_enhance(matrix, params)

    # ------------------------------------------------------------------
    # Real model inference
    # ------------------------------------------------------------------

    def _real_enhance(
        self,
        matrix: np.ndarray,
        params: EnhanceParams,
        fasta_sequences: dict[str, str] | None = None,
        contig_names: list[str] | None = None,
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
            enhanced_norm = self._infer_whole_map(
                normalized, size,
                fasta_sequences=fasta_sequences,
                contig_names=contig_names,
            )
        else:
            enhanced_norm = self._infer_tiled(
                normalized, size,
                fasta_sequences=fasta_sequences,
                contig_names=contig_names,
            )

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
        fasta_sequences: dict[str, str] | None = None,
        contig_names: list[str] | None = None,
    ) -> np.ndarray:
        """Process the entire map as a single input, padding to chunk_size."""
        chunk = self.chunk_size
        padded_size = math.ceil(size / chunk) * chunk

        # Pad with zeros to nearest multiple of chunk_size
        padded = np.zeros((padded_size, padded_size), dtype=np.float64)
        padded[:size, :size] = normalized

        output = self._run_model_on_tile(
            padded,
            fasta_sequences=fasta_sequences,
            contig_names=contig_names,
            tile_start_bin=0,
            tile_end_bin=padded_size,
            overview_size=size,
            texture_size=size,
        )

        # Crop back to original size
        return output[:size, :size]

    def _infer_tiled(
        self,
        normalized: np.ndarray,
        size: int,
        fasta_sequences: dict[str, str] | None = None,
        contig_names: list[str] | None = None,
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

                # Run model (use row-based bin range for DNA)
                result = self._run_model_on_tile(
                    tile,
                    fasta_sequences=fasta_sequences,
                    contig_names=contig_names,
                    tile_start_bin=row,
                    tile_end_bin=row + chunk,
                    overview_size=size,
                    texture_size=size,
                )

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

    def _run_model_on_tile(
        self,
        tile: np.ndarray,
        fasta_sequences: dict[str, str] | None = None,
        contig_names: list[str] | None = None,
        tile_start_bin: int = 0,
        tile_end_bin: int | None = None,
        overview_size: int | None = None,
        texture_size: int = 0,
    ) -> np.ndarray:
        """Run the model forward pass on a single tile.

        Constructs the input dict expected by CDNA2d.forward():
        - input_matrix: (batch=1, S=1, H=1, channels=1, height, width)
        - DNA_row / DNA_col: encoded DNA tensors (or empty for zero fallback)
        - mappability_row / mappability_col: ones or empty tensors
        """
        assert self.model is not None

        h, w = tile.shape
        resolution = 2000
        if self.model_args and "resolution" in self.model_args:
            resolution = self.model_args["resolution"]

        # Model expects shape: (batch, S, H, channels, height, width)
        input_tensor = (
            torch.from_numpy(tile)
            .float()
            .unsqueeze(0)  # channels
            .unsqueeze(0)  # H
            .unsqueeze(0)  # S
            .unsqueeze(0)  # batch
        )

        # Build DNA tensors if FASTA is available
        if fasta_sequences and overview_size:
            end_bin = tile_end_bin if tile_end_bin is not None else tile_start_bin + h
            encoded = prepare_dna_for_tile(
                fasta_sequences=fasta_sequences,
                contig_names=contig_names,
                tile_start_bin=tile_start_bin,
                tile_end_bin=end_bin,
                resolution=resolution,
                overview_size=overview_size,
                texture_size=texture_size,
            )
            num_bases = encoded.shape[0]
            dna_tensor = prepare_dna_tensor(encoded, self.device)
            map_tensor = prepare_mappability_tensor(num_bases, self.device)
            data = {
                "input_matrix": input_tensor.to(self.device),
                "DNA_row": dna_tensor,
                "DNA_col": dna_tensor,
                "mappability_row": map_tensor,
                "mappability_col": map_tensor,
            }
        else:
            data = {
                "input_matrix": input_tensor.to(self.device),
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


# ======================================================================
# Epigenomic track prediction
# ======================================================================

TRACK_INFO = [
    ("DNase", "#1f77b4"),
    ("CTCF", "#ff7f0e"),
    ("H3K27ac", "#2ca02c"),
    ("H3K27me3", "#d62728"),
    ("H3K4me3", "#9467bd"),
]

NUM_EPI_TRACKS = len(TRACK_INFO)

EPI_MODEL_VERSION = "mock-epi-0.1.0"


class Evo2HiCEpiModel:
    """Epigenomic track prediction from Hi-C contact maps.

    Loads real CHNFTQ/Evo2HiC CDNAtrack weights when configured, otherwise
    falls back to mock prediction that generates plausible tracks from the
    diagonal signal.
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
        """Load epi model weights from checkpoint.

        Args:
            checkpoint_path: Path to epi model checkpoint. If None, checks
                EVO2HIC_EPI_CHECKPOINT env var, then tries auto-detection
                relative to EVO2HIC_CHECKPOINT. Falls back to mock if not found.
            device: Torch device string. Auto-detected if None.
        """
        if device is None:
            self.device = _detect_device()
        else:
            self.device = device

        # Resolve checkpoint path
        ckpt = checkpoint_path or EVO2HIC_EPI_CHECKPOINT

        # Auto-detect: look for epi_prediction/model.pt as sibling of the
        # enhancement checkpoint directory
        if ckpt is None and EVO2HIC_CHECKPOINT is not None:
            grandparent = Path(EVO2HIC_CHECKPOINT).parent.parent
            candidate = grandparent / "epi_prediction" / "model.pt"
            if candidate.is_file():
                ckpt = str(candidate)
                logger.info("Auto-detected epi checkpoint: %s", ckpt)

        if ckpt is not None:
            try:
                self._load_real_model(ckpt)
                return
            except Exception:
                logger.exception(
                    "Failed to load real Evo2HiC epi model from %s; "
                    "falling back to mock inference",
                    ckpt,
                )

        logger.info("Epi model running in mock inference mode")
        self._loaded = False

    def _load_real_model(self, checkpoint_path: str) -> None:
        """Load the real CDNAtrack model from a checkpoint.

        Follows the same loading pattern as Evo2HiCModel._load_real_model()
        but imports create_model from model.create_CDNA1d instead of 2d.
        """
        if not _ensure_evo2hic_importable():
            raise RuntimeError(
                "EVO2HIC_REPO_PATH is not set or invalid. "
                "Cannot import Evo2HiC model code."
            )

        # Resolve symlinks
        try:
            ckpt = os.readlink(checkpoint_path)
        except OSError:
            ckpt = checkpoint_path

        if not os.path.isfile(ckpt):
            raise FileNotFoundError(f"Epi checkpoint not found: {ckpt}")

        # Load args.json from the same directory as the checkpoint
        args_file = os.path.join(os.path.dirname(ckpt), "args.json")
        if not os.path.isfile(args_file):
            raise FileNotFoundError(
                f"args.json not found next to epi checkpoint: {args_file}"
            )

        with open(args_file) as f:
            args = json.load(f)

        self.model_args = args

        # Import Evo2HiC modules
        from dataset.normalizer import Normalizer  # type: ignore[import-untyped]
        from model.create_CDNA1d import create_model  # type: ignore[import-untyped]

        # Build normalizer
        self.normalizer = Normalizer(
            args["normalization"],
            max_reads=args["max_reads"],
            denominator=args["denominator"],
            step=args["step"],
        )

        # Supply defaults for args that create_model expects
        model_defaults = {
            "input_channels": args.get("input_channels", 1),
            "track_input_dim": args.get("track_input_dim", 256),
            "use_multiresolution_block": args.get("use_multiresolution_block", True),
            "relative_resolutions": args.get("relative_resolutions", [1, 2, 4, 5]),
            "emb_dim": args.get("emb_dim", 128),
            "normalize_emb": args.get("normalize_emb", True),
            "force_final_conv": args.get("force_final_conv", False),
            "use_mrcrossembed": args.get("use_mrcrossembed", True),
            "encoder_version": args.get("encoder_version", "v1"),
            "resolution": args.get("resolution", 2000),
        }

        model = create_model(**{**model_defaults, **args})

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

        # Extract chunk size from model args
        if "chunk" in args:
            self.chunk_size = args["chunk"]
        elif "chunk_size" in args:
            self.chunk_size = args["chunk_size"]

        global EPI_MODEL_VERSION, EPI_MODEL_LOADED
        EPI_MODEL_VERSION = f"evo2hic-epi-{Path(ckpt).stem}"
        EPI_MODEL_LOADED = True

        logger.info(
            "Loaded real Evo2HiC epi model from %s (device=%s, chunk_size=%d)",
            ckpt,
            self.device,
            self.chunk_size,
        )

    def predict_tracks(
        self,
        contact_map: np.ndarray,
        size: int,
        fasta_sequences: dict[str, str] | None = None,
        contig_names: list[str] | None = None,
    ) -> list[dict]:
        """Predict epigenomic tracks from a Hi-C contact map.

        Args:
            contact_map: Flattened float32 contact map (size * size elements).
            size: Side length of the square contact map.
            fasta_sequences: Optional contig name -> sequence mapping.
            contig_names: Ordered contig names for mapping bins to sequences.

        Returns:
            List of 5 dicts with keys: name, values (np.ndarray), color.
        """
        matrix = contact_map.reshape(size, size).astype(np.float64)

        if self._loaded and self.model is not None and self.normalizer is not None:
            return self._real_predict(
                matrix,
                fasta_sequences=fasta_sequences,
                contig_names=contig_names,
            )

        return self._mock_predict(matrix)

    # ------------------------------------------------------------------
    # Real model inference
    # ------------------------------------------------------------------

    def _real_predict(
        self,
        matrix: np.ndarray,
        fasta_sequences: dict[str, str] | None = None,
        contig_names: list[str] | None = None,
    ) -> list[dict]:
        """Run real CDNAtrack model inference."""
        assert self.model is not None
        assert self.normalizer is not None

        size = matrix.shape[0]
        resolution = 2000
        if self.model_args and "resolution" in self.model_args:
            resolution = self.model_args["resolution"]

        # Normalize the contact map
        normalized = self.normalizer.normalize(matrix)  # type: ignore[union-attr]

        chunk = self.chunk_size
        padded_size = math.ceil(size / chunk) * chunk

        # Pad with zeros to nearest multiple of chunk_size
        padded = np.zeros((padded_size, padded_size), dtype=np.float64)
        padded[:size, :size] = normalized

        # Build input tensor: (batch=1, S=1, H=1, channels=1, height, width)
        input_tensor = (
            torch.from_numpy(padded)
            .float()
            .unsqueeze(0)  # channels
            .unsqueeze(0)  # H
            .unsqueeze(0)  # S
            .unsqueeze(0)  # batch
        )

        # Build DNA tensors if FASTA is available
        if fasta_sequences:
            encoded = prepare_dna_for_tile(
                fasta_sequences=fasta_sequences,
                contig_names=contig_names,
                tile_start_bin=0,
                tile_end_bin=padded_size,
                resolution=resolution,
                overview_size=size,
                texture_size=size,
            )
            num_bases = encoded.shape[0]
            dna_tensor = prepare_dna_tensor(encoded, self.device)
            map_tensor = prepare_mappability_tensor(num_bases, self.device)
            data = {
                "input_matrix": input_tensor.to(self.device),
                "DNA0": dna_tensor,
                "mappability0": map_tensor,
            }
        else:
            data = {
                "input_matrix": input_tensor.to(self.device),
                "DNA0": torch.empty(0).to(self.device),
                "mappability0": torch.empty(0).to(self.device),
            }

        with torch.no_grad():
            output = self.model(**data)

        # Output shape: (batch, S, H, num_tracks, num_positions)
        # Extract tracks and crop to original size
        tracks_array = output[0, 0, 0, :, :size].cpu().numpy()
        tracks_array = np.clip(tracks_array, 0.0, 1.0)

        results = []
        for i, (name, color) in enumerate(TRACK_INFO):
            results.append({
                "name": name,
                "values": tracks_array[i].astype(np.float32),
                "color": color,
            })
        return results

    # ------------------------------------------------------------------
    # Mock inference (fallback)
    # ------------------------------------------------------------------

    def _mock_predict(self, matrix: np.ndarray) -> list[dict]:
        """Generate plausible mock epigenomic tracks from diagonal signal.

        Produces 5 tracks correlated with Hi-C contact map features:
        - DNase: high where diagonal signal is strong
        - CTCF: peaks at contig boundaries (insulator binding)
        - H3K27ac: correlated with DNase but smoother
        - H3K27me3: anti-correlated with H3K27ac (repressive mark)
        - H3K4me3: sharp peaks at intervals (promoters)
        """
        size = matrix.shape[0]

        # Extract diagonal signal as the base feature
        diagonal = np.array([matrix[i, i] for i in range(size)], dtype=np.float64)
        if diagonal.max() > 0:
            diagonal /= diagonal.max()

        # DNase: smoothed diagonal signal
        dnase = gaussian_filter(diagonal, sigma=2.0)
        dnase = np.clip(dnase, 0, 1)

        # CTCF: peaks near local drops in off-diagonal contact (boundary-like)
        off_diag = np.zeros(size, dtype=np.float64)
        for i in range(size):
            window = min(3, size - i - 1, i)
            if window > 0:
                off_diag[i] = np.mean([
                    matrix[i, i + d] for d in range(1, window + 1)
                ])
        if off_diag.max() > 0:
            off_diag /= off_diag.max()
        # Negative derivative of off-diagonal → boundary signal
        ctcf = np.zeros(size, dtype=np.float64)
        ctcf[1:] = np.maximum(-np.diff(off_diag), 0)
        ctcf = gaussian_filter(ctcf, sigma=1.0)
        if ctcf.max() > 0:
            ctcf /= ctcf.max()

        # H3K27ac: smoother version of DNase (active enhancers)
        h3k27ac = gaussian_filter(diagonal, sigma=4.0)
        h3k27ac = np.clip(h3k27ac, 0, 1)

        # H3K27me3: anti-correlated with H3K27ac (repressive mark)
        h3k27me3 = 1.0 - h3k27ac
        h3k27me3 = gaussian_filter(h3k27me3, sigma=3.0)
        h3k27me3 = np.clip(h3k27me3, 0, 1)

        # H3K4me3: sharp peaks at regular intervals (promoters)
        h3k4me3 = np.zeros(size, dtype=np.float64)
        interval = max(1, size // 20)
        for i in range(0, size, interval):
            h3k4me3[i] = 0.8 + 0.2 * diagonal[i]
        h3k4me3 = gaussian_filter(h3k4me3, sigma=1.0)
        if h3k4me3.max() > 0:
            h3k4me3 /= h3k4me3.max()

        track_arrays = [dnase, ctcf, h3k27ac, h3k27me3, h3k4me3]

        results = []
        for i, (name, color) in enumerate(TRACK_INFO):
            results.append({
                "name": name,
                "values": track_arrays[i].astype(np.float32),
                "color": color,
            })
        return results
