from __future__ import annotations

import re

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..dependencies import get_current_user
from ..models import User
from ..plugin_loader import list_available_plugins
from ..schemas import (
    AppSettingsIn,
    AppSettingsOut,
    PluginSettingsIn,
    PluginSettingsOut,
    UserOut,
)
from ..services import ConfigStore

router = APIRouter()

DEFAULT_TIME_FORMAT = "YYYY-MM-DD HH:mm:ss"
TIME_FORMAT_PATTERN = re.compile(r"^[YMDHms:/.\-\s]+$")


def normalize_plugin_names(values: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for raw in values:
        name = str(raw).strip()
        if not name or name in seen:
            continue
        seen.add(name)
        ordered.append(name)
    return ordered


def resolve_enabled_plugins(user: User) -> list[str]:
    available = set(list_available_plugins())
    stored = ConfigStore.get(user, "enabled_plugins", None)
    if isinstance(stored, list):
        return [name for name in normalize_plugin_names(stored) if name in available]
    return []


def normalize_time_format(raw: object) -> str:
    value = str(raw or "").strip()
    if not value:
        return DEFAULT_TIME_FORMAT
    if len(value) > 64:
        value = value[:64]
    if not TIME_FORMAT_PATTERN.match(value):
        return DEFAULT_TIME_FORMAT
    if not any(token in value for token in ("YYYY", "MM", "DD", "HH", "mm", "ss")):
        return DEFAULT_TIME_FORMAT
    return value


def apply_plugin_settings_to_runtime(user: User) -> None:
    enabled = resolve_enabled_plugins(user)
    object.__setattr__(settings, "plugins", ",".join(enabled))


@router.get("/api/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut(id=user.id, email=user.email)


@router.get("/api/settings/general", response_model=AppSettingsOut)
def get_general_settings(user: User = Depends(get_current_user)) -> AppSettingsOut:
    return AppSettingsOut(
        default_fetch_interval_min=int(
            ConfigStore.get(user, "default_fetch_interval_min", 30)
        ),
        fulltext_enabled=bool(
            ConfigStore.get(user, "fulltext_enabled", settings.fulltext_enabled)
        ),
        cleanup_retention_days=int(
            ConfigStore.get(user, "cleanup_retention_days", 30)
        ),
        cleanup_keep_content=bool(
            ConfigStore.get(user, "cleanup_keep_content", True)
        ),
        image_cache_enabled=bool(
            ConfigStore.get(user, "image_cache_enabled", False)
        ),
        auto_refresh_interval_sec=max(
            0,
            min(int(ConfigStore.get(user, "auto_refresh_interval_sec", 0)), 86400),
        ),
        time_format=normalize_time_format(
            ConfigStore.get(user, "time_format", DEFAULT_TIME_FORMAT),
        ),
    )


@router.put("/api/settings/general", response_model=AppSettingsOut)
def update_general_settings(
    payload: AppSettingsIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AppSettingsOut:
    ConfigStore.set(
        user,
        "default_fetch_interval_min",
        max(1, min(payload.default_fetch_interval_min, 1440)),
    )
    ConfigStore.set(user, "fulltext_enabled", payload.fulltext_enabled)
    ConfigStore.set(
        user,
        "cleanup_retention_days",
        max(1, min(payload.cleanup_retention_days, 3650)),
    )
    ConfigStore.set(user, "cleanup_keep_content", payload.cleanup_keep_content)
    ConfigStore.set(user, "image_cache_enabled", payload.image_cache_enabled)
    ConfigStore.set(
        user,
        "auto_refresh_interval_sec",
        max(0, min(payload.auto_refresh_interval_sec, 86400)),
    )
    ConfigStore.set(user, "time_format", normalize_time_format(payload.time_format))
    db.commit()
    return get_general_settings(user)


@router.get("/api/settings/plugins", response_model=PluginSettingsOut)
def get_plugin_settings(user: User = Depends(get_current_user)) -> PluginSettingsOut:
    return PluginSettingsOut(
        available=list_available_plugins(),
        enabled=resolve_enabled_plugins(user),
    )


@router.put("/api/settings/plugins", response_model=PluginSettingsOut)
def update_plugin_settings(
    payload: PluginSettingsIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PluginSettingsOut:
    available = set(list_available_plugins())
    enabled = [name for name in normalize_plugin_names(payload.enabled) if name in available]
    ConfigStore.set(user, "enabled_plugins", enabled)
    apply_plugin_settings_to_runtime(user)
    db.commit()
    return PluginSettingsOut(
        available=sorted(available),
        enabled=resolve_enabled_plugins(user),
    )
