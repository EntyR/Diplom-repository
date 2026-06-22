"""
embed_service.py — тонкий Python микросервис для извлечения эмбеддингов лиц.

Принимает: multipart/form-data с полем "image"
Возвращает JSON:
  {
    "embedding": [512 float],
    "bbox":      [x1, y1, x2, y2],
    "pose":      {"yaw": float, "pitch": float, "roll": float}
  }
  или {"error": "no_face"} с кодом 422

Всё остальное (Qdrant, бизнес-логика, HTTP API) — в Go-сервисе.
"""

import logging
import os
import shutil
import tempfile

import cv2
import numpy as np
import onnxruntime as ort

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from insightface.app import FaceAnalysis

# ── Config ────────────────────────────────────────────────────────────────────

MODEL_TAG = os.getenv("MODEL_TAG", "buffalo_l")
CUDA_ON   = os.getenv("CUDA_ON", "false").lower() in ("true", "1", "yes")
LOG_FACES = os.getenv("LOG_FACES", "false").lower() in ("true", "1", "yes")

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
log = logging.getLogger("embed_service")

# ── InsightFace init ──────────────────────────────────────────────────────────

_SCORE_WEIGHTS = {"area": 1.0, "center": 0.5, "angle": 50.0}


def _build_analyzer() -> FaceAnalysis:
    available = ort.get_available_providers()
    if CUDA_ON and "CUDAExecutionProvider" in available:
        providers, ctx = ["CUDAExecutionProvider"], 0
        log.info("CUDA provider active")
    else:
        if CUDA_ON:
            log.info("CUDA unavailable, falling back to CPU")
        providers, ctx = ["CPUExecutionProvider"], -1

    analyzer = FaceAnalysis(name=MODEL_TAG, providers=providers)
    analyzer.prepare(ctx_id=ctx)
    log.info("InsightFace model '%s' loaded", MODEL_TAG)
    return analyzer


analyzer = _build_analyzer()

# ── FastAPI ───────────────────────────────────────────────────────────────────

app = FastAPI(title="Embed Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _face_score(face, img_shape) -> float:
    x1, y1, x2, y2 = face.bbox
    area = (x2 - x1) * (y2 - y1)
    h, w = img_shape[:2]
    cx_gap = ((x1 + x2) / 2) - w / 2
    cy_gap = ((y1 + y2) / 2) - h / 2
    centrality = -((cx_gap ** 2 + cy_gap ** 2) ** 0.5)
    yaw, pitch, _ = face.pose
    frontality = -(abs(yaw) + abs(pitch))
    return (
        area        * _SCORE_WEIGHTS["area"]
        + centrality * _SCORE_WEIGHTS["center"]
        + frontality * _SCORE_WEIGHTS["angle"]
    )


def _best_face(img: np.ndarray):
    faces = analyzer.get(img=img)
    if LOG_FACES:
        log.info("%d face(s) detected", len(faces))
    if not faces:
        return None
    return max(faces, key=lambda f: _face_score(f, img.shape))


# ── Endpoint ──────────────────────────────────────────────────────────────────

@app.post("/embed")
async def embed(image: UploadFile = File(...)):
    """
    Upload an image, get back the best face embedding + bbox + pose.
    Returns 422 if no face is detected.
    """
    with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
        shutil.copyfileobj(image.file, tmp)
        tmp_path = tmp.name

    try:
        img = cv2.imread(tmp_path)
        if img is None:
            raise HTTPException(status_code=400, detail="cannot_decode_image")

        face = _best_face(img)
        if face is None:
            raise HTTPException(status_code=422, detail="no_face")

        embedding = face.embedding.flatten().tolist()
        bbox      = face.bbox.tolist()
        yaw, pitch, roll = map(float, face.pose)

        return {
            "embedding": embedding,
            "bbox":      bbox,
            "pose":      {"yaw": yaw, "pitch": pitch, "roll": roll},
        }
    finally:
        os.remove(tmp_path)


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_TAG}
