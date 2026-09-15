from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .clip_model import ClipModel
from .config import Settings

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


def model() -> ClipModel:
    return state["model"]


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
