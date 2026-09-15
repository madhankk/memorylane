import uvicorn

from .config import Settings


def main() -> None:
    s = Settings()
    uvicorn.run("memorylane_ai.main:app", host=s.host, port=s.port, log_level="info")


if __name__ == "__main__":
    main()
