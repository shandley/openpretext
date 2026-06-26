"""FastAPI server for the HiCFoundation Hi-C-only ML backend (Phase 0 stub)."""

from __future__ import annotations

import base64
import time
from contextlib import asynccontextmanager
from typing import AsyncIterator

import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import inference
from .inference import HiCFoundationEpiModel, HiCFoundationModel
from .schemas import (
    EnhanceRequest,
    EnhanceResponse,
    HealthResponse,
    PredictTracksRequest,
    PredictTracksResponse,
    TrackPrediction,
)

model = HiCFoundationModel()
epi_model = HiCFoundationEpiModel()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    model.load_model()
    epi_model.load_model()
    yield


app = FastAPI(
    title="HiCFoundation Server (mock)",
    version=inference.MODEL_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _decode_contact_map(b64: str, map_size: int) -> np.ndarray:
    try:
        raw = base64.b64decode(b64)
        contact_map = np.frombuffer(raw, dtype=np.float32)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid contact_map encoding: {e}")
    expected = map_size * map_size
    if len(contact_map) != expected:
        raise HTTPException(
            status_code=400,
            detail=(
                f"contact_map has {len(contact_map)} elements, expected "
                f"{expected} ({map_size}x{map_size})"
            ),
        )
    return contact_map


@app.get("/api/v1/health")
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        model_loaded=model.is_loaded,
        device=model.device,
        model_version=inference.MODEL_VERSION,
    )


@app.post("/api/v1/enhance")
async def enhance(request: EnhanceRequest) -> EnhanceResponse:
    t0 = time.perf_counter()
    contact_map = _decode_contact_map(request.contact_map, request.map_size)

    try:
        enhanced, new_size = model.enhance(contact_map, request.map_size, request.params)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Enhancement failed: {e}")

    encoded = base64.b64encode(enhanced.tobytes()).decode("ascii")
    upscale_factor = request.params.upscale_factor if request.params else 4
    return EnhanceResponse(
        enhanced_map=encoded,
        enhanced_size=new_size,
        upscale_factor=upscale_factor,
        model_version=inference.MODEL_VERSION,
        elapsed_ms=round((time.perf_counter() - t0) * 1000.0, 2),
    )


@app.post("/api/v1/predict-tracks")
async def predict_tracks(request: PredictTracksRequest) -> PredictTracksResponse:
    t0 = time.perf_counter()
    contact_map = _decode_contact_map(request.contact_map, request.map_size)

    try:
        tracks = epi_model.predict_tracks(contact_map, request.map_size)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Track prediction failed: {e}")

    track_predictions = [
        TrackPrediction(
            name=t["name"],
            values=base64.b64encode(t["values"].tobytes()).decode("ascii"),
            color=t["color"],
        )
        for t in tracks
    ]
    return PredictTracksResponse(
        tracks=track_predictions,
        model_version=inference.EPI_MODEL_VERSION,
        elapsed_ms=round((time.perf_counter() - t0) * 1000.0, 2),
    )


def run() -> None:
    """Entry point for the `hicfoundation-server` script (port 8001)."""
    uvicorn.run(
        "hicfoundation_server.main:app",
        host="0.0.0.0",
        port=8001,
        reload=False,
    )


if __name__ == "__main__":
    run()
