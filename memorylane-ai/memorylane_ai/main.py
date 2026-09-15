from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .clip_model import ClipModel, _providers
from .cluster import chinese_whispers
from .config import Settings
from .face_model import FACE_MODELS, FaceModel, create_face_model, face_model_id

settings = Settings()
state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    state["model"] = ClipModel(settings.model_repo, settings.device)
    yield


app = FastAPI(title="memorylane-ai", lifespan=lifespan)


def require_token(authorization: str | None = Header(default=None)) -> None:
    if settings.token and authorization != f"Bearer {settings.token}":
        raise HTTPException(status_code=401, detail="Invalid or missing token")


class TextRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=64)


class ClusterRequest(BaseModel):
    vectors: list[list[float]] = Field(min_length=1, max_length=200_000)
    threshold: float = Field(default=0.5, ge=0.0, le=1.0)
    min_cluster_size: int = Field(default=3, ge=1)
    iterations: int = Field(default=20, ge=1, le=100)


def model() -> ClipModel:
    return state["model"]


# Loaded on first use so CLIP-only setups keep their fast startup; the
# detector download is ~38 MB.
FACE_ID, FACE_DIM_ACTIVE = face_model_id(settings.face_model)


# Any known face model can be requested per call (Settings › People picks
# one); each loads lazily on first use and stays resident.
def face_model(name: str | None = None) -> FaceModel:
    name = name or settings.face_model
    if name not in FACE_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown face model '{name}'")
    key = f"faces:{name}"
    if key not in state:
        state[key] = create_face_model(name, _providers(settings.device))
    return state[key]


@app.get("/v1/health")
def health(_: None = Depends(require_token)):
    info = model().info
    return {
        "ok": True,
        "device": info.device,
        "providers": info.providers,
        "max_batch": settings.max_batch,
        "models": {
            "image_embed": {"id": info.id, "dim": info.dim},
            "text_embed": {"id": info.id, "dim": info.dim},
            "faces": {"id": FACE_ID, "dim": FACE_DIM_ACTIVE},
        },
        "face_models": [{"name": n, **m} for n, m in FACE_MODELS.items()],
    }


@app.post("/v1/embed/image")
async def embed_image(files: list[UploadFile] = File(...), _: None = Depends(require_token)):
    if not 1 <= len(files) <= settings.max_batch:
        raise HTTPException(status_code=400, detail=f"Send between 1 and {settings.max_batch} files")
    data = [await f.read() for f in files]
    try:
        vectors = model().embed_images(data)
    except Exception as exc:  # undecodable image etc. - the caller's problem, not an outage
        raise HTTPException(status_code=422, detail=f"Could not process an image: {exc}") from exc
    info = model().info
    return {"model": info.id, "dim": info.dim, "vectors": vectors.tolist()}


@app.post("/v1/embed/text")
def embed_text(req: TextRequest, _: None = Depends(require_token)):
    vectors = model().embed_texts(req.texts)
    info = model().info
    return {"model": info.id, "dim": info.dim, "vectors": vectors.tolist()}


@app.post("/v1/faces")
async def faces(files: list[UploadFile] = File(...), model: str | None = Form(default=None), _: None = Depends(require_token)):
    if not 1 <= len(files) <= 16:
        raise HTTPException(status_code=400, detail="Send between 1 and 16 files")
    data = [await f.read() for f in files]
    name = model or settings.face_model
    if name not in FACE_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown face model '{name}'")
    model_id, dim = face_model_id(name)
    try:
        fm = face_model(name)
    except Exception as exc:  # model download/load failure is an outage, not a bad request
        raise HTTPException(status_code=503, detail=f"Face model unavailable: {exc}") from exc
    try:
        results = fm.detect_and_embed(data)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not process an image: {exc}") from exc
    return {
        "model": model_id,
        "dim": dim,
        "images": [
            [{"bbox": f.bbox, "landmarks": f.landmarks, "det_score": f.det_score, "embedding": f.embedding.tolist()} for f in image]
            for image in results
        ],
    }


@app.post("/v1/cluster")
def cluster(req: ClusterRequest, _: None = Depends(require_token)):
    import numpy as np

    dims = {len(v) for v in req.vectors}
    if len(dims) != 1:
        raise HTTPException(status_code=422, detail="All vectors must have the same length")
    labels = chinese_whispers(np.asarray(req.vectors, dtype=np.float32), req.threshold, req.min_cluster_size, req.iterations)
    return {"labels": labels}
