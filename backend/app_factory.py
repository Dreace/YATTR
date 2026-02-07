from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings


def create_app() -> FastAPI:
    app = FastAPI(title="YATTR")
    app.state.scheduler = None
    allow_origins = [origin for origin in settings.cors_origins if origin != "*"]
    allow_origin_regex = settings.cors_allow_origin_regex.strip() or None
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_origin_regex=allow_origin_regex,
        allow_credentials=settings.cors_allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    return app
