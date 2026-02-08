from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


def _load_dotenv() -> None:
    config_dir = Path(__file__).resolve().parent
    candidate_paths = (
        Path.cwd() / ".env",
        config_dir / ".env",
        config_dir.parent / ".env",
    )
    seen: set[Path] = set()
    for path in candidate_paths:
        resolved = path.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        load_dotenv(dotenv_path=resolved, override=False)


_load_dotenv()


def _env(name: str, default: str) -> str:
    value = os.getenv(name)
    return value if value is not None and value != "" else default


def _env_int(name: str, default: int) -> int:
    raw = _env(name, str(default))
    try:
        return int(raw)
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = _env(name, "true" if default else "false").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _env_list(name: str, default: str) -> tuple[str, ...]:
    raw = _env(name, default)
    values = [item.strip() for item in raw.split(",")]
    return tuple(item for item in values if item)


@dataclass(frozen=True)
class Settings:
    secret_key: str = _env("RSS_SECRET_KEY", "change_me")
    admin_email: str = _env("RSS_ADMIN_EMAIL", "admin")
    admin_password: str = _env("RSS_ADMIN_PASSWORD", "change_me")
    db_url: str = _env("RSS_DB_URL", "sqlite:///./data/rss.sqlite")
    # Runtime plugin enabling is controlled via /api/settings/plugins.
    # Keep default empty so no plugin is enabled unless explicitly configured.
    plugins: str = ""
    fulltext_enabled: bool = _env_bool("RSS_FULLTEXT_ENABLED", False)
    testing: bool = _env_bool("RSS_TESTING", False)
    auth_access_token_minutes: int = _env_int("RSS_AUTH_ACCESS_TOKEN_MINUTES", 15)
    auth_refresh_token_days: int = _env_int("RSS_AUTH_REFRESH_TOKEN_DAYS", 30)
    auth_cookie_secure: bool = _env_bool("RSS_AUTH_COOKIE_SECURE", False)
    auth_cookie_samesite: str = _env("RSS_AUTH_COOKIE_SAMESITE", "lax")
    auth_cookie_domain: str = _env("RSS_AUTH_COOKIE_DOMAIN", "")
    cors_origins: tuple[str, ...] = _env_list(
        "RSS_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    )
    cors_allow_origin_regex: str = _env(
        "RSS_CORS_ALLOW_ORIGIN_REGEX",
        r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    )
    cors_allow_credentials: bool = _env_bool("RSS_CORS_ALLOW_CREDENTIALS", True)
    network_block_private: bool = _env_bool("RSS_NETWORK_BLOCK_PRIVATE", True)
    network_max_response_bytes: int = _env_int("RSS_NETWORK_MAX_RESPONSE_BYTES", 5 * 1024 * 1024)
    scheduler_fetch_interval_min: int = _env_int("RSS_SCHEDULER_FETCH_INTERVAL_MIN", 1)
    scheduler_cleanup_interval_min: int = _env_int("RSS_SCHEDULER_CLEANUP_INTERVAL_MIN", 30)
    scheduler_max_feeds_per_tick: int = _env_int("RSS_SCHEDULER_MAX_FEEDS_PER_TICK", 20)


settings = Settings()


def ensure_secure_runtime_settings() -> None:
    if settings.testing:
        return
    insecure_keys: list[str] = []
    if settings.secret_key.strip() == "change_me":
        insecure_keys.append("RSS_SECRET_KEY")
    if settings.admin_password.strip() == "change_me":
        insecure_keys.append("RSS_ADMIN_PASSWORD")
    if insecure_keys:
        names = ", ".join(insecure_keys)
        raise RuntimeError(f"Insecure defaults detected: {names}")
