from __future__ import annotations

import hashlib
import re
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
from lxml import html as lxml_html

from .config import settings
from .network_safety import fetch_bytes_response


def _data_root() -> Path:
    if settings.db_url.startswith("sqlite:///"):
        path = settings.db_url.split("sqlite:///", 1)[-1]
        if path.startswith("./"):
            path = path[2:]
        db_path = Path(path)
        if db_path.parent:
            return db_path.parent
    return Path("data")


def cache_root() -> Path:
    return _data_root() / "cache"


def image_cache_dir() -> Path:
    return cache_root() / "images"


def favicon_cache_dir() -> Path:
    return cache_root() / "favicons"


def ensure_cache_dirs() -> None:
    image_cache_dir().mkdir(parents=True, exist_ok=True)
    favicon_cache_dir().mkdir(parents=True, exist_ok=True)


def _safe_ext(url: str, content_type: str | None) -> str:
    path_ext = Path(urlparse(url).path).suffix.lower()
    if path_ext in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico"}:
        return path_ext
    if content_type:
        kind = content_type.split(";", 1)[0].strip().lower()
        mapping = {
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/jpg": ".jpg",
            "image/gif": ".gif",
            "image/webp": ".webp",
            "image/svg+xml": ".svg",
            "image/x-icon": ".ico",
            "image/vnd.microsoft.icon": ".ico",
        }
        if kind in mapping:
            return mapping[kind]
    return ".bin"


def normalize_site_key(site: str) -> str:
    value = (site or "").strip()
    if not value:
        return ""
    source = value
    if "://" in value or "/" in value:
        if "://" not in value:
            value = f"https://{value}"
        parsed = urlparse(value)
        host = (parsed.hostname or source).lower()
    else:
        host = value.lower()
    if host.startswith("www."):
        host = host[4:]
    host = host.strip().strip(".")
    return host or source


def _identicon_svg(site: str, size: int = 64, grid: int = 5, padding: int = 4) -> str:
    key = normalize_site_key(site)
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    r = (int(digest[0:2], 16) + 80) % 256
    g = (int(digest[2:4], 16) + 80) % 256
    b = (int(digest[4:6], 16) + 80) % 256

    bits = bin(int(digest[6 : 6 + 24], 16))[2:].zfill(96)
    cols_left = (grid + 1) // 2
    cell = max(1, (size - 2 * padding) // grid)
    offset_x = (size - cell * grid) // 2
    offset_y = (size - cell * grid) // 2

    rects: list[str] = []
    bit_index = 0
    for row in range(grid):
        left = []
        for _ in range(cols_left):
            left.append(bits[bit_index] == "1")
            bit_index += 1
        full_row = left + left[:-1][::-1]
        for col, active in enumerate(full_row):
            if not active:
                continue
            x = offset_x + col * cell
            y = offset_y + row * cell
            rects.append(
                f'<rect x="{x}" y="{y}" width="{cell}" height="{cell}" fill="rgb({r},{g},{b})" />'
            )

    body = "".join(rects)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
        f'viewBox="0 0 {size} {size}">'
        f'<rect x="0" y="0" width="{size}" height="{size}" fill="rgb(245,245,245)" />'
        f"{body}</svg>"
    )


def cache_identicon(site_url: str) -> str | None:
    key = normalize_site_key(site_url)
    if not key:
        return None
    ensure_cache_dirs()
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    safe = re.sub(r"[^a-zA-Z0-9_.-]+", "_", key).strip("._") or "site"
    file_name = f"{safe[:60]}-{digest[:16]}.svg"
    file_path = favicon_cache_dir() / file_name
    if not file_path.exists():
        file_path.write_text(_identicon_svg(key), encoding="utf-8")
    return f"/api/cache/favicons/{file_path.name}"


def cache_remote_asset(url: str, kind: str, require_image: bool = False) -> str | None:
    if not url:
        return None
    if kind not in {"images", "favicons"}:
        return None

    ensure_cache_dirs()
    target_dir = image_cache_dir() if kind == "images" else favicon_cache_dir()
    key = hashlib.sha256(url.encode("utf-8")).hexdigest()

    with httpx.Client(timeout=20, follow_redirects=True) as client:
        response, payload = fetch_bytes_response(client, url)
        content_type = response.headers.get("Content-Type")
        if require_image:
            media_type = (content_type or "").split(";", 1)[0].strip().lower()
            if not media_type.startswith("image/"):
                raise ValueError(f"Unsupported favicon content type: {content_type or 'unknown'}")
        ext = _safe_ext(url, content_type)
        if kind == "favicons" and ext == ".bin":
            ext = ".ico"
        file_path = target_dir / f"{key}{ext}"
        if not file_path.exists():
            file_path.write_bytes(payload)
    return f"/api/cache/{kind}/{file_path.name}"


def cache_site_favicon(site_url: str | None) -> str | None:
    if not site_url:
        return None
    parsed = urlparse(site_url)
    if not parsed.scheme or not parsed.netloc:
        return cache_identicon(site_url)
    favicon_url = f"{parsed.scheme}://{parsed.netloc}/favicon.ico"
    try:
        return cache_remote_asset(favicon_url, "favicons", require_image=True)
    except Exception:  # noqa: BLE001
        return cache_identicon(site_url)


def cache_images_in_html(html_content: str | None, base_url: str | None) -> str | None:
    if not html_content:
        return html_content
    try:
        root = lxml_html.fragment_fromstring(html_content, create_parent=True)
    except Exception:  # noqa: BLE001
        return html_content

    for node in root.xpath(".//img[@src]"):
        src = node.get("src", "").strip()
        if not src or src.startswith("data:"):
            continue
        absolute = urljoin(base_url or "", src)
        try:
            cached = cache_remote_asset(absolute, "images")
        except Exception:  # noqa: BLE001
            cached = None
        if cached:
            node.set("src", cached)

    return "".join(
        lxml_html.tostring(child, encoding="unicode")
        for child in root.iterchildren()
    )
