from __future__ import annotations

import httpx
from readability import Document

from .network_safety import fetch_text_response


def extract_fulltext(url: str | None) -> str | None:
    if not url:
        return None
    try:
        with httpx.Client(timeout=20, follow_redirects=True) as client:
            _, body_text = fetch_text_response(client, url)
            doc = Document(body_text)
            return doc.summary()
    except Exception:  # noqa: BLE001
        return None
