"""FastAPI server for Evo2HiC Hi-C contact map enhancement."""

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
from .inference import Evo2HiCEpiModel, Evo2HiCModel, Evo2HiCSeq2HiCModel
from .schemas import (
    EnhanceRequest,
    EnhanceResponse,
    HealthResponse,
    PredictHiCRequest,
    PredictHiCResponse,
    PredictTracksRequest,
    PredictTracksResponse,
    TrackPrediction,
)

model = Evo2HiCModel()
epi_model = Evo2HiCEpiModel()
seq2hic_model = Evo2HiCSeq2HiCModel()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Load models on startup."""
    model.load_model()
    epi_model.load_model()
    seq2hic_model.load_model()
    yield


app = FastAPI(
    title="Evo2HiC Enhancement Server",
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


@app.get("/api/v1/health")
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        model_loaded=model.is_loaded,
        epi_model_loaded=epi_model.is_loaded,
        seq2hic_model_loaded=seq2hic_model.is_loaded,
        device=model.device,
        model_version=inference.MODEL_VERSION,
    )


@app.post("/api/v1/enhance")
async def enhance(request: EnhanceRequest) -> EnhanceResponse:
    t0 = time.perf_counter()

    # Decode base64 contact map to float32 array
    try:
        raw = base64.b64decode(request.contact_map)
        contact_map = np.frombuffer(raw, dtype=np.float32)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid contact_map encoding: {e}")

    expected_len = request.map_size * request.map_size
    if len(contact_map) != expected_len:
        raise HTTPException(
            status_code=400,
            detail=f"contact_map has {len(contact_map)} elements, expected {expected_len} ({request.map_size}x{request.map_size})",
        )

    # Run enhancement
    try:
        enhanced, new_size = model.enhance(
            contact_map,
            request.map_size,
            fasta=request.fasta_sequences,
            contig_names=request.contig_names,
            params=request.params,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Enhancement failed: {e}")

    # Encode result back to base64
    encoded = base64.b64encode(enhanced.tobytes()).decode("ascii")
    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    upscale_factor = request.params.upscale_factor if request.params else 4

    return EnhanceResponse(
        enhanced_map=encoded,
        enhanced_size=new_size,
        upscale_factor=upscale_factor,
        model_version=inference.MODEL_VERSION,
        elapsed_ms=round(elapsed_ms, 2),
    )


@app.post("/api/v1/predict-tracks")
async def predict_tracks(request: PredictTracksRequest) -> PredictTracksResponse:
    t0 = time.perf_counter()

    # Decode base64 contact map to float32 array
    try:
        raw = base64.b64decode(request.contact_map)
        contact_map = np.frombuffer(raw, dtype=np.float32)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid contact_map encoding: {e}")

    expected_len = request.map_size * request.map_size
    if len(contact_map) != expected_len:
        raise HTTPException(
            status_code=400,
            detail=f"contact_map has {len(contact_map)} elements, expected {expected_len} ({request.map_size}x{request.map_size})",
        )

    # Run track prediction
    try:
        tracks = epi_model.predict_tracks(
            contact_map,
            request.map_size,
            fasta_sequences=request.fasta_sequences,
            contig_names=request.contig_names,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Track prediction failed: {e}")

    # Encode track values to base64
    track_predictions = [
        TrackPrediction(
            name=t["name"],
            values=base64.b64encode(t["values"].tobytes()).decode("ascii"),
            color=t["color"],
        )
        for t in tracks
    ]

    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    return PredictTracksResponse(
        tracks=track_predictions,
        model_version=inference.EPI_MODEL_VERSION,
        elapsed_ms=round(elapsed_ms, 2),
    )


@app.post("/api/v1/predict-hic")
async def predict_hic(request: PredictHiCRequest) -> PredictHiCResponse:
    t0 = time.perf_counter()

    if not request.fasta_sequences:
        raise HTTPException(status_code=400, detail="fasta_sequences is required and must not be empty")

    # Run Seq2HiC prediction
    try:
        predicted, size = seq2hic_model.predict_hic(
            fasta_sequences=request.fasta_sequences,
            contig_names=request.contig_names,
            map_size=request.map_size,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Seq2HiC prediction failed: {e}")

    # Encode result to base64
    encoded = base64.b64encode(predicted.tobytes()).decode("ascii")
    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    return PredictHiCResponse(
        predicted_map=encoded,
        map_size=size,
        model_version=inference.SEQ2HIC_MODEL_VERSION,
        elapsed_ms=round(elapsed_ms, 2),
    )


def run() -> None:
    """Entry point for the `evo2hic-server` script."""
    uvicorn.run(
        "evo2hic_server.main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
    )
