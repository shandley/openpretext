"""Pydantic request/response models for the HiCFoundation server.

Phase 0 reuses the Evo2HiC enhance / predict-tracks contracts (base64-encoded
Float32Array payloads) so the two backends are interchangeable on the client.
There is no FASTA field — HiCFoundation is Hi-C-only.
"""

from __future__ import annotations

from pydantic import BaseModel


class EnhanceParams(BaseModel):
    upscale_factor: int = 4  # 4x or 16x
    denoise: bool = True


class EnhanceRequest(BaseModel):
    contact_map: str  # base64-encoded Float32Array bytes
    map_size: int
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


class TrackPrediction(BaseModel):
    name: str
    values: str  # base64-encoded Float32Array
    color: str  # hex color


class PredictTracksResponse(BaseModel):
    tracks: list[TrackPrediction]
    model_version: str
    elapsed_ms: float


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    device: str
    model_version: str
