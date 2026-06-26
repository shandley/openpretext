"""Inference for the HiCFoundation server.

Phase 0 is mock-only: resolution enhancement via Gaussian denoise + bicubic
upscale + symmetry, and epigenomic tracks synthesized from the diagonal signal.
This keeps the full client/server pipeline runnable without GPU or weights.

A real implementation would load HiCFoundation (Noble-Lab) ViT weights when
HICFOUNDATION_CHECKPOINT is set and run patch-wise inference; that is left as a
TODO for later phases.
"""

from __future__ import annotations

import logging
import os

import numpy as np
from scipy.ndimage import gaussian_filter, zoom

from .schemas import EnhanceParams

logger = logging.getLogger(__name__)

HICFOUNDATION_CHECKPOINT = os.environ.get("HICFOUNDATION_CHECKPOINT")

MODEL_VERSION = "hicfoundation-mock-0.1.0"
EPI_MODEL_VERSION = "hicfoundation-mock-epi-0.1.0"


def _detect_device() -> str:
    """Mock always runs on CPU; real model would detect CUDA/MPS."""
    return "cpu"


class HiCFoundationModel:
    """Resolution enhancement model (mock)."""

    def __init__(self) -> None:
        self.device = "cpu"
        self._loaded = False

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    def load_model(self) -> None:
        self.device = _detect_device()
        if HICFOUNDATION_CHECKPOINT:
            logger.warning(
                "HICFOUNDATION_CHECKPOINT=%s set, but real weights are not "
                "implemented in this stub; using mock inference",
                HICFOUNDATION_CHECKPOINT,
            )
        else:
            logger.info("HiCFoundation running in mock inference mode")
        self._loaded = True

    def enhance(
        self,
        contact_map: np.ndarray,
        size: int,
        params: EnhanceParams | None,
    ) -> tuple[np.ndarray, int]:
        p = params or EnhanceParams()
        matrix = contact_map.reshape(size, size).astype(np.float64)

        # 1. Denoise
        if p.denoise:
            matrix = gaussian_filter(matrix, sigma=0.8)
        # 2. Bicubic upscale to target resolution
        upscaled = zoom(matrix, p.upscale_factor, order=3)
        new_size = upscaled.shape[0]
        # 3. Mild unsharp-mask sharpening
        blurred = gaussian_filter(upscaled, sigma=1.0)
        sharpened = upscaled + 0.3 * (upscaled - blurred)
        # 4. Enforce Hi-C symmetry, clamp non-negative
        symmetric = np.maximum((sharpened + sharpened.T) / 2.0, 0.0)

        return symmetric.astype(np.float32).ravel(), new_size


TRACK_INFO = [
    ("DNase", "#1f77b4"),
    ("CTCF", "#ff7f0e"),
    ("H3K27ac", "#2ca02c"),
    ("H3K27me3", "#d62728"),
    ("H3K4me3", "#9467bd"),
]


class HiCFoundationEpiModel:
    """Epigenomic track prediction (mock).

    Synthesizes plausible per-bin tracks from the diagonal/short-range contact
    signal, with a distinct transform per track so they are visually different.
    """

    def __init__(self) -> None:
        self.device = "cpu"
        self._loaded = False

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    def load_model(self) -> None:
        self.device = _detect_device()
        self._loaded = True

    def predict_tracks(self, contact_map: np.ndarray, size: int) -> list[dict]:
        matrix = contact_map.reshape(size, size).astype(np.float64)

        # Short-range signal per bin: mean of a small diagonal band.
        band = max(1, size // 32)
        signal = np.zeros(size, dtype=np.float64)
        for i in range(size):
            lo = max(0, i - band)
            hi = min(size, i + band + 1)
            signal[i] = matrix[i, lo:hi].mean()

        def normalize(v: np.ndarray) -> np.ndarray:
            v = v - v.min()
            m = v.max()
            return (v / m) if m > 0 else v

        tracks: list[dict] = []
        for idx, (name, color) in enumerate(TRACK_INFO):
            # Distinct deterministic transform per track.
            sigma = 0.5 + idx * 0.75
            smoothed = gaussian_filter(signal, sigma=sigma)
            if idx % 2 == 1:
                smoothed = smoothed.max() - smoothed  # invert some tracks
            values = normalize(smoothed).astype(np.float32)
            tracks.append({"name": name, "values": values, "color": color})
        return tracks
