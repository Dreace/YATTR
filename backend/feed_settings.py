from __future__ import annotations

from dataclasses import dataclass

from .config import settings
from .models import Feed, User
from .services import ConfigStore


@dataclass(frozen=True)
class UserFeedDefaults:
    default_fetch_interval_min: int
    fulltext_enabled: bool
    cleanup_retention_days: int
    cleanup_keep_content: bool
    image_cache_enabled: bool


@dataclass(frozen=True)
class EffectiveFeedSettings:
    fetch_interval_min: int
    fulltext_enabled: bool
    cleanup_retention_days: int
    cleanup_keep_content: bool
    image_cache_enabled: bool


def _clamp_int(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(int(value), maximum))


def default_user_feed_defaults() -> UserFeedDefaults:
    return UserFeedDefaults(
        default_fetch_interval_min=30,
        fulltext_enabled=bool(settings.fulltext_enabled),
        cleanup_retention_days=30,
        cleanup_keep_content=True,
        image_cache_enabled=False,
    )


def resolve_user_feed_defaults(user: User) -> UserFeedDefaults:
    defaults = default_user_feed_defaults()
    return UserFeedDefaults(
        default_fetch_interval_min=_clamp_int(
            int(
                ConfigStore.get(
                    user,
                    "default_fetch_interval_min",
                    defaults.default_fetch_interval_min,
                )
            ),
            1,
            1440,
        ),
        fulltext_enabled=bool(
            ConfigStore.get(user, "fulltext_enabled", defaults.fulltext_enabled)
        ),
        cleanup_retention_days=_clamp_int(
            int(
                ConfigStore.get(
                    user,
                    "cleanup_retention_days",
                    defaults.cleanup_retention_days,
                )
            ),
            1,
            3650,
        ),
        cleanup_keep_content=bool(
            ConfigStore.get(
                user,
                "cleanup_keep_content",
                defaults.cleanup_keep_content,
            )
        ),
        image_cache_enabled=bool(
            ConfigStore.get(
                user,
                "image_cache_enabled",
                defaults.image_cache_enabled,
            )
        ),
    )


def resolve_effective_feed_settings(
    feed: Feed,
    defaults: UserFeedDefaults,
) -> EffectiveFeedSettings:
    fetch_interval_min = (
        defaults.default_fetch_interval_min
        if feed.use_global_fetch_interval
        else _clamp_int(feed.fetch_interval_min, 1, 1440)
    )
    cleanup_retention_days = (
        defaults.cleanup_retention_days
        if feed.use_global_cleanup_retention
        else _clamp_int(feed.cleanup_retention_days, 1, 3650)
    )
    return EffectiveFeedSettings(
        fetch_interval_min=fetch_interval_min,
        fulltext_enabled=(
            defaults.fulltext_enabled
            if feed.use_global_fulltext
            else bool(feed.fulltext_enabled)
        ),
        cleanup_retention_days=cleanup_retention_days,
        cleanup_keep_content=(
            defaults.cleanup_keep_content
            if feed.use_global_cleanup_keep_content
            else bool(feed.cleanup_keep_content)
        ),
        image_cache_enabled=(
            defaults.image_cache_enabled
            if feed.use_global_image_cache
            else bool(feed.image_cache_enabled)
        ),
    )


def apply_feed_setting_overrides(
    feed: Feed,
    defaults: UserFeedDefaults,
    *,
    fetch_interval_min: int | None,
    fulltext_enabled: bool | None,
    cleanup_retention_days: int | None,
    cleanup_keep_content: bool | None,
    image_cache_enabled: bool | None,
) -> None:
    if fetch_interval_min is None:
        feed.use_global_fetch_interval = True
    else:
        normalized_interval = _clamp_int(fetch_interval_min, 1, 1440)
        feed.use_global_fetch_interval = (
            normalized_interval == defaults.default_fetch_interval_min
        )
        feed.fetch_interval_min = normalized_interval

    if fulltext_enabled is None:
        feed.use_global_fulltext = True
    else:
        normalized_fulltext = bool(fulltext_enabled)
        feed.use_global_fulltext = normalized_fulltext == defaults.fulltext_enabled
        feed.fulltext_enabled = normalized_fulltext

    if cleanup_retention_days is None:
        feed.use_global_cleanup_retention = True
    else:
        normalized_retention = _clamp_int(cleanup_retention_days, 1, 3650)
        feed.use_global_cleanup_retention = (
            normalized_retention == defaults.cleanup_retention_days
        )
        feed.cleanup_retention_days = normalized_retention

    if cleanup_keep_content is None:
        feed.use_global_cleanup_keep_content = True
    else:
        normalized_keep_content = bool(cleanup_keep_content)
        feed.use_global_cleanup_keep_content = (
            normalized_keep_content == defaults.cleanup_keep_content
        )
        feed.cleanup_keep_content = normalized_keep_content

    if image_cache_enabled is None:
        feed.use_global_image_cache = True
    else:
        normalized_image_cache = bool(image_cache_enabled)
        feed.use_global_image_cache = (
            normalized_image_cache == defaults.image_cache_enabled
        )
        feed.image_cache_enabled = normalized_image_cache
