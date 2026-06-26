"""HiCFoundation companion server (Phase 0 stub).

A Hi-C-only ML backend mirroring the Evo2HiC server's /api/v1 contract for
resolution enhancement and epigenomic track prediction. Ships with mock
inference so it runs with no GPU or model weights; real HiCFoundation weights
load when HICFOUNDATION_CHECKPOINT is set (not implemented in this stub).
"""
