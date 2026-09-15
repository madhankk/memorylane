import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    host: str = os.environ.get("MEMORYLANE_AI_HOST", "127.0.0.1")
    port: int = int(os.environ.get("MEMORYLANE_AI_PORT", "4281"))
    model_repo: str = os.environ.get("MEMORYLANE_AI_MODEL", "Xenova/clip-vit-base-patch32")
    # cpu (default: fastest reliable choice measured on Apple Silicon), coreml, cuda, auto
    device: str = os.environ.get("MEMORYLANE_AI_DEVICE", "cpu")
    token: str | None = os.environ.get("MEMORYLANE_AI_TOKEN") or None
    max_batch: int = int(os.environ.get("MEMORYLANE_AI_MAX_BATCH", "32"))
