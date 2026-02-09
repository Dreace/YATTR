from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    email: str


class AuthSessionOut(Token):
    expires_in: int
    user: UserOut


class ApiKeyOut(BaseModel):
    api_key: str


class AppSettingsIn(BaseModel):
    default_fetch_interval_min: int = 30
    fulltext_enabled: bool = False
    cleanup_retention_days: int = 30
    cleanup_keep_content: bool = True
    image_cache_enabled: bool = False
    auto_refresh_interval_sec: int = 0
    time_format: str = "YYYY-MM-DD HH:mm:ss"


class AppSettingsOut(AppSettingsIn):
    pass


class PluginSettingsIn(BaseModel):
    enabled: List[str] = Field(default_factory=list)


class PluginSettingsOut(BaseModel):
    available: List[str]
    enabled: List[str]


class FolderIn(BaseModel):
    name: str
    sort_order: int = 0


class FolderOut(FolderIn):
    id: int


class FeedIn(BaseModel):
    title: str
    url: str
    site_url: Optional[str] = None
    folder_id: Optional[int] = None
    disabled: Optional[bool] = None
    fetch_interval_min: Optional[int] = None
    fulltext_enabled: Optional[bool] = None
    cleanup_retention_days: Optional[int] = None
    cleanup_keep_content: Optional[bool] = None
    image_cache_enabled: Optional[bool] = None


class FeedOut(FeedIn):
    id: int
    site_url: Optional[str] = None
    icon_url: Optional[str] = None
    last_status: int = 0
    error_count: int = 0
    disabled: bool = False


class FeedValidateIn(BaseModel):
    url: str


class FeedValidateOut(BaseModel):
    valid: bool
    title: str
    site_url: Optional[str] = None
    message: Optional[str] = None


class EntryOut(BaseModel):
    id: int
    feed_id: int
    title: str
    url: Optional[str] = None
    author: Optional[str] = None
    published_at: int
    summary: Optional[str] = None
    content_html: Optional[str] = None
    content_text: Optional[str] = None
    is_read: Optional[bool] = None
    is_starred: Optional[bool] = None
    is_later: Optional[bool] = None


class EntryPageOut(BaseModel):
    items: List[EntryOut]
    next_cursor: Optional[int] = None
    has_more: bool = False
    current_page: int = 1
    total_pages: int = 1
    total_items: int = 0


class FeedUnreadCountOut(BaseModel):
    feed_id: int
    unread_count: int


class DebugEntryOut(BaseModel):
    id: int
    feed_id: int
    title: str
    url: Optional[str] = None
    published_at: int
    summary: Optional[str] = None
    content_html: Optional[str] = None
    content_text: Optional[str] = None


class EntryStateUpdate(BaseModel):
    is_read: Optional[bool] = None
    is_starred: Optional[bool] = None
    is_later: Optional[bool] = None


class BatchStateUpdate(BaseModel):
    entry_ids: List[int] = Field(default_factory=list)
    is_read: Optional[bool] = None
    is_starred: Optional[bool] = None
    is_later: Optional[bool] = None


class FilterIn(BaseModel):
    name: str
    enabled: bool = True
    priority: int = 0
    match_json: str = "{}"
    actions_json: str = "{}"


class FilterOut(FilterIn):
    id: int


class SearchResult(BaseModel):
    id: int
    feed_id: int
    title: str
    summary: Optional[str] = None
    content_text: Optional[str] = None
    url: Optional[str] = None
    is_read: Optional[bool] = None
    is_starred: Optional[bool] = None
    is_later: Optional[bool] = None


class FetchLogOut(BaseModel):
    id: int
    feed_id: int
    status: int
    fetched_at: int
    error_message: Optional[str] = None
