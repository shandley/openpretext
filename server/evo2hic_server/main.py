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
from .inference import Evo2HiCModel
from .schemas import EnhanceRequest, EnhanceResponse, HealthResponse

model = Evo2HiCModel()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Load model on startup."""
    model.load_model()
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


def run() -> None:
    """Entry point for the `evo2hic-server` script."""
    uvicorn.run(
        "evo2hic_server.main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
    )
