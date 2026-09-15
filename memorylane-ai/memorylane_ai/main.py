from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .clip_model import ClipModel, _providers
from .cluster import chinese_whispers
from .config import Settings
from .face_model import FACE_DIM, FACE_MODEL_ID, FaceModel

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
def face_model() -> FaceModel:
    if "faces" not in state:
        state["faces"] = FaceModel(_providers(settings.device))
    return state["faces"]


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
            "faces": {"id": FACE_MODEL_ID, "dim": FACE_DIM},
        },
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
async def faces(files: list[UploadFile] = File(...), _: None = Depends(require_token)):
    if not 1 <= len(files) <= 16:
        raise HTTPException(status_code=400, detail="Send between 1 and 16 files")
    data = [await f.read() for f in files]
    try:
        fm = face_model()
    except Exception as exc:  # model download/load failure is an outage, not a bad request
        raise HTTPException(status_code=503, detail=f"Face model unavailable: {exc}") from exc
    try:
        results = fm.detect_and_embed(data)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not process an image: {exc}") from exc
    return {
        "model": FACE_MODEL_ID,
        "dim": FACE_DIM,
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
