"""DNA sequence encoding for Evo2HiC model input.

Pure numpy functions that convert FASTA sequences into one-hot encoded
arrays suitable for the DNAEncoder module in the Evo2HiC models.
"""

from __future__ import annotations

import logging

import numpy as np
import torch

logger = logging.getLogger(__name__)

# One-hot encoding: A=0, C=1, G=2, T=3, anything else (N) = all zeros
_BASE_TO_INDEX = {
    "A": 0, "a": 0,
    "C": 1, "c": 1,
    "G": 2, "g": 2,
    "T": 3, "t": 3,
}


def encode_sequence(sequence: str) -> np.ndarray:
    """One-hot encode a DNA sequence.

    Returns:
        (num_bases, 4) float32 array.
        A=[1,0,0,0], C=[0,1,0,0], G=[0,0,1,0], T=[0,0,0,1], N=[0,0,0,0]
    """
    n = len(sequence)
    encoded = np.zeros((n, 4), dtype=np.float32)
    for i, base in enumerate(sequence):
        idx = _BASE_TO_INDEX.get(base)
        if idx is not None:
            encoded[i, idx] = 1.0
    return encoded


def _concatenate_fasta(
    fasta_sequences: dict[str, str],
    contig_names: list[str] | None = None,
) -> str:
    """Concatenate FASTA sequences in contig order.

    If contig_names is provided, sequences are concatenated in that order.
    Otherwise, sequences are concatenated in dict iteration order.
    Missing contigs are silently skipped.
    """
    if contig_names is not None:
        parts = []
        for name in contig_names:
            if name in fasta_sequences:
                parts.append(fasta_sequences[name])
        return "".join(parts)
    return "".join(fasta_sequences.values())


def prepare_dna_for_tile(
    fasta_sequences: dict[str, str],
    contig_names: list[str] | None,
    tile_start_bin: int,
    tile_end_bin: int,
    resolution: int,
    overview_size: int,
    texture_size: int,
) -> np.ndarray:
    """Extract and encode DNA for a tile region.

    Maps overview bins to genomic coordinates, extracts FASTA subsequences,
    one-hot encodes them, and returns a (num_bases, 4) array.

    Each overview bin covers (genome_length / overview_size) bases.
    The model's DNA encoder expects ``resolution`` bases per bin (typically
    2000).  A tile of N bins therefore needs N * resolution bases.  When the
    overview compresses the genome (each pixel >> 2000 bp), the sequence is
    subsampled to the required length.

    Args:
        fasta_sequences: Contig name -> DNA sequence mapping.
        contig_names: Ordered contig names for mapping bins to sequences.
        tile_start_bin: Start bin index in the overview (inclusive).
        tile_end_bin: End bin index in the overview (exclusive).
        resolution: Model resolution in bases per bin (typically 2000).
        overview_size: Size of the overview map in bins.
        texture_size: Full texture size in pixels (unused, kept for API).

    Returns:
        (num_bins * resolution, 4) float32 one-hot encoded array.
    """
    num_bins = tile_end_bin - tile_start_bin
    num_bases_needed = num_bins * resolution

    # Concatenate all FASTA sequences into a single genome string
    genome = _concatenate_fasta(fasta_sequences, contig_names)
    genome_length = len(genome)

    if genome_length == 0:
        return np.zeros((num_bases_needed, 4), dtype=np.float32)

    # Each overview bin covers this many genome bases
    bases_per_bin = genome_length / overview_size

    # Genomic range covered by this tile
    genomic_start = int(tile_start_bin * bases_per_bin)
    genomic_end = int(tile_end_bin * bases_per_bin)
    genomic_end = min(genomic_end, genome_length)

    region = genome[genomic_start:genomic_end]
    region_length = len(region)

    if region_length == 0:
        return np.zeros((num_bases_needed, 4), dtype=np.float32)

    # Subsample or pad to exactly num_bases_needed bases
    if region_length >= num_bases_needed:
        indices = np.linspace(0, region_length - 1, num_bases_needed, dtype=int)
        subsampled = "".join(region[i] for i in indices)
    else:
        subsampled = region + "N" * (num_bases_needed - region_length)

    return encode_sequence(subsampled)


def prepare_dna_tensor(
    encoded: np.ndarray,
    device: str,
) -> torch.Tensor:
    """Convert encoded DNA to a model-ready tensor.

    For both CDNA2d (DNA_row / DNA_col) and CDNA1d (DNA0) the models
    ultimately call ``DNAEncoder.forward(x, map)`` which expects
    ``x`` with shape ``(batch, num_bases, 4)`` and internally transposes
    to ``(batch, 4, num_bases)`` for the Conv1d layers.

    With B=S=H=1 for single-tile inference the tensor is shaped
    ``(1, 1, 1, num_bases, 4)``; after ``flatten(0, 2)`` inside the
    model this becomes ``(1, num_bases, 4)`` as required.

    Args:
        encoded: (num_bases, 4) float32 numpy array from encode_sequence()
            or prepare_dna_for_tile().
        device: Torch device string.

    Returns:
        Tensor of shape (1, 1, 1, num_bases, 4).
    """
    tensor = torch.from_numpy(encoded).float()
    # (B=1, S=1, H=1, num_bases, 4)
    tensor = tensor.unsqueeze(0).unsqueeze(0).unsqueeze(0)
    return tensor.to(device)


def prepare_mappability_tensor(
    num_bases: int,
    device: str,
) -> torch.Tensor:
    """Create a full-mappability (all ones) tensor.

    Shape ``(1, 1, 1, num_bases)`` so that after ``flatten(0, 2)`` it
    becomes ``(1, num_bases)`` matching the DNAEncoder's ``map`` argument.
    """
    tensor = torch.ones(1, 1, 1, num_bases, dtype=torch.float32)
    return tensor.to(device)
