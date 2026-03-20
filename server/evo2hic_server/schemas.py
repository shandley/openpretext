"""Pydantic models for the Evo2HiC enhancement API."""

from pydantic import BaseModel


class EnhanceParams(BaseModel):
    upscale_factor: int = 4  # 4x or 16x
    denoise: bool = True


class EnhanceRequest(BaseModel):
    contact_map: str  # base64-encoded Float32Array bytes
    map_size: int
    fasta_sequences: dict[str, str] | None = None  # contig_name -> sequence
    contig_names: list[str] | None = None
    params: EnhanceParams | None = None


class EnhanceResponse(BaseModel):
    enhanced_map: str  # base64-encoded Float32Array bytes
    enhanced_size: int
    upscale_factor: int
    model_version: str
    elapsed_ms: float


class PredictTracksRequest(BaseModel):
    contact_map: str  # base64-encoded Float32Array
    map_size: int
    fasta_sequences: dict[str, str] | None = None
    contig_names: list[str] | None = None


class TrackPrediction(BaseModel):
    name: str
    values: str  # base64-encoded Float32Array
    color: str   # hex color


class PredictTracksResponse(BaseModel):
    tracks: list[TrackPrediction]
    model_version: str
    elapsed_ms: float


class PredictHiCRequest(BaseModel):
    fasta_sequences: dict[str, str]  # contig_name -> sequence (required)
    contig_names: list[str] | None = None
    map_size: int = 64  # output overview size


class PredictHiCResponse(BaseModel):
    predicted_map: str  # base64-encoded Float32Array
    map_size: int
    model_version: str
    elapsed_ms: float


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    epi_model_loaded: bool
    seq2hic_model_loaded: bool
    device: str
    model_version: str
