from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .cache_assets import ensure_cache_dirs, favicon_cache_dir, image_cache_dir


def frontend_dist() -> Path:
    return Path(__file__).resolve().parent / "frontend_dist"


def mount_cache_static(app: FastAPI) -> None:
    if getattr(app.state, "_cache_static_mounted", False):
        return
    ensure_cache_dirs()
    app.mount(
        "/api/cache/images",
        StaticFiles(directory=image_cache_dir()),
        name="cache-images",
    )
    app.mount(
        "/api/cache/favicons",
        StaticFiles(directory=favicon_cache_dir()),
        name="cache-favicons",
    )
    app.state._cache_static_mounted = True


def mount_frontend_static(app: FastAPI) -> None:
    if getattr(app.state, "_frontend_static_mounted", False):
        return
    dist = frontend_dist()
    if not dist.exists():
        return

    assets_dir = dist / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="frontend-assets")

    @app.get("/", include_in_schema=False)
    def frontend_index() -> FileResponse:
        return FileResponse(dist / "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    def frontend_spa(full_path: str):  # type: ignore[override]
        if full_path.startswith(("api/", "fever/", "plugins/")):
            raise HTTPException(status_code=404, detail="Not found")
        target = dist / full_path
        if target.exists() and target.is_file():
            return FileResponse(target)
        return FileResponse(dist / "index.html")

    app.state._frontend_static_mounted = True
